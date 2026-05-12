using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Azure.Data.Tables;
using Azure.Storage.Blobs;
using Microsoft.AspNetCore.Http.Features;

var builder = WebApplication.CreateBuilder(args);

var corsOrigin = builder.Configuration["CORS_ORIGIN"] ?? "https://mhairiandbarnabywedding.com";
var uploadPassword = builder.Configuration["UPLOAD_PASSWORD"] ?? throw new InvalidOperationException("UPLOAD_PASSWORD not configured");
var tokenSecret = builder.Configuration["TOKEN_SECRET"] ?? throw new InvalidOperationException("TOKEN_SECRET not configured");
var connectionString = builder.Configuration["AZURE_STORAGE_CONNECTION_STRING"] ?? throw new InvalidOperationException("AZURE_STORAGE_CONNECTION_STRING not configured");
var blobContainerName = builder.Configuration["BLOB_CONTAINER_NAME"] ?? "wedding-photos";
var tableName = builder.Configuration["TABLE_NAME"] ?? "photos";

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins(corsOrigin.Split(','))
              .WithMethods("GET", "POST")
              .WithHeaders("Content-Type", "Authorization"));
});

builder.Services.AddSingleton(new BlobServiceClient(connectionString));
builder.Services.AddSingleton(new TableClient(connectionString, tableName));

builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 25 * 1024 * 1024);

var app = builder.Build();
app.UseCors();

var rateLimits = new ConcurrentDictionary<string, List<DateTimeOffset>>();
var secretBytes = Encoding.UTF8.GetBytes(tokenSecret);

string CreateToken()
{
    var expiry = DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds().ToString();
    using var hmac = new HMACSHA256(secretBytes);
    var sig = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(expiry)));
    return Convert.ToBase64String(Encoding.UTF8.GetBytes($"{expiry}.{sig}"));
}

bool ValidateToken(string token, out long expiresAt)
{
    expiresAt = 0;
    try
    {
        var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(token));
        var parts = decoded.Split('.', 2);
        if (parts.Length != 2) return false;

        var expiry = parts[0];
        if (!long.TryParse(expiry, out expiresAt)) return false;
        if (DateTimeOffset.UtcNow.ToUnixTimeSeconds() > expiresAt) return false;

        using var hmac = new HMACSHA256(secretBytes);
        var expectedSig = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(expiry)));
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(parts[1]),
            Encoding.UTF8.GetBytes(expectedSig));
    }
    catch { return false; }
}

bool ExtractAndValidateToken(HttpContext ctx, out long expiresAt)
{
    expiresAt = 0;
    var auth = ctx.Request.Headers.Authorization.ToString();
    if (!auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return false;
    return ValidateToken(auth["Bearer ".Length..], out expiresAt);
}

bool CheckRateLimit(string ip)
{
    var now = DateTimeOffset.UtcNow;
    var attempts = rateLimits.GetOrAdd(ip, _ => new List<DateTimeOffset>());
    lock (attempts)
    {
        attempts.RemoveAll(t => now - t > TimeSpan.FromMinutes(1));
        if (attempts.Count >= 5) return false;
        attempts.Add(now);
        return true;
    }
}

var allowedTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
{
    "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"
};

var extensionMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
{
    ["image/jpeg"] = ".jpg",
    ["image/png"] = ".png",
    ["image/heic"] = ".heic",
    ["image/heif"] = ".heif",
    ["image/webp"] = ".webp"
};

app.MapGet("/", () => Results.Ok());

app.MapPost("/api/login", (HttpContext ctx, LoginRequest req) =>
{
    var ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    if (!CheckRateLimit(ip))
        return Results.Json(new { error = "Too many attempts. Please wait a minute." }, statusCode: 429);

    if (!string.Equals(req.Password?.Trim(), uploadPassword, StringComparison.OrdinalIgnoreCase))
        return Results.Json(new { error = "Invalid password" }, statusCode: 401);

    return Results.Ok(new { token = CreateToken(), expiresIn = 3600 });
});

app.MapGet("/api/verify", (HttpContext ctx) =>
{
    if (!ExtractAndValidateToken(ctx, out var expiresAt))
        return Results.Json(new { error = "Invalid or expired token" }, statusCode: 401);

    return Results.Ok(new { valid = true, expiresAt });
});

app.MapGet("/api/photos", async (HttpContext ctx, BlobServiceClient blobService, TableClient table) =>
{
    var pageParam = ctx.Request.Query["page"].FirstOrDefault();
    var pageSizeParam = ctx.Request.Query["pageSize"].FirstOrDefault();
    var visitorId = ctx.Request.Query["visitorId"].FirstOrDefault() ?? "";
    var page = Math.Max(1, int.TryParse(pageParam, out var p) ? p : 1);
    var pageSize = Math.Clamp(int.TryParse(pageSizeParam, out var ps) ? ps : 20, 1, 50);

    var allPhotos = new List<TableEntity>();
    await foreach (var entity in table.QueryAsync<TableEntity>(filter: "PartitionKey eq 'photo'"))
    {
        allPhotos.Add(entity);
    }

    var heartCounts = new Dictionary<string, int>();
    var visitorHearts = new HashSet<string>();
    await foreach (var heart in table.QueryAsync<TableEntity>(filter: "PartitionKey ge 'heart_' and PartitionKey lt 'heart`'"))
    {
        var photoId = heart.PartitionKey["heart_".Length..];
        heartCounts[photoId] = heartCounts.GetValueOrDefault(photoId) + 1;
        if (heart.RowKey == visitorId)
            visitorHearts.Add(photoId);
    }

    allPhotos.Sort((a, b) =>
    {
        var aHearts = heartCounts.GetValueOrDefault(a.RowKey!, 0);
        var bHearts = heartCounts.GetValueOrDefault(b.RowKey!, 0);
        if (aHearts != bHearts) return bHearts.CompareTo(aHearts);
        var aTime = a.GetDateTimeOffset("UploadedAt") ?? DateTimeOffset.MinValue;
        var bTime = b.GetDateTimeOffset("UploadedAt") ?? DateTimeOffset.MinValue;
        return aTime.CompareTo(bTime);
    });

    var totalCount = allPhotos.Count;
    var totalPages = (int)Math.Ceiling((double)totalCount / pageSize);
    var items = allPhotos.Skip((page - 1) * pageSize).Take(pageSize);

    var container = blobService.GetBlobContainerClient(blobContainerName);
    var photos = new List<object>();

    foreach (var entity in items)
    {
        var blobName = entity.GetString("BlobName");
        var blob = container.GetBlobClient(blobName);
        var sasUri = blob.GenerateSasUri(Azure.Storage.Sas.BlobSasPermissions.Read, DateTimeOffset.UtcNow.AddHours(1));
        var id = entity.RowKey!;

        photos.Add(new
        {
            id,
            credit = entity.GetString("Credit") ?? "Anonymous",
            uploadedAt = entity.GetDateTimeOffset("UploadedAt"),
            url = sasUri.ToString(),
            hearts = heartCounts.GetValueOrDefault(id, 0),
            hearted = visitorHearts.Contains(id)
        });
    }

    return Results.Ok(new { photos, page, pageSize, totalCount, totalPages });
});

app.MapPost("/api/photos/{id}/heart", async (string id, HttpContext ctx, TableClient table) =>
{
    var body = await ctx.Request.ReadFromJsonAsync<HeartRequest>();
    if (string.IsNullOrWhiteSpace(body?.VisitorId) || body.VisitorId.Length > 64)
        return Results.Json(new { error = "Invalid visitorId" }, statusCode: 400);

    var partitionKey = $"heart_{id}";
    var rowKey = body.VisitorId;

    try
    {
        var existing = await table.GetEntityAsync<TableEntity>(partitionKey, rowKey);
        await table.DeleteEntityAsync(partitionKey, rowKey, existing.Value.ETag);
        return Results.Ok(new { hearted = false });
    }
    catch (Azure.RequestFailedException ex) when (ex.Status == 404)
    {
        var entity = new TableEntity(partitionKey, rowKey)
        {
            ["HeartedAt"] = DateTimeOffset.UtcNow
        };
        await table.AddEntityAsync(entity);
        return Results.Ok(new { hearted = true });
    }
});

app.MapPost("/api/upload", async (HttpContext ctx, BlobServiceClient blobService, TableClient table) =>
{
    if (!ExtractAndValidateToken(ctx, out _))
        return Results.Json(new { error = "Invalid or expired token" }, statusCode: 401);

    var form = await ctx.Request.ReadFormAsync();
    var file = form.Files.GetFile("photo");
    if (file is null || file.Length == 0)
        return Results.Json(new { error = "No photo provided" }, statusCode: 400);

    if (file.Length > 20 * 1024 * 1024)
        return Results.Json(new { error = "File too large. Maximum size is 20 MB." }, statusCode: 413);

    if (!allowedTypes.Contains(file.ContentType))
        return Results.Json(new { error = "Unsupported file type. Please upload a JPEG, PNG, HEIC, or WebP image." }, statusCode: 400);

    var credit = form.TryGetValue("credit", out var creditValues) ? creditValues.ToString().Trim() : "Anonymous";
    if (string.IsNullOrEmpty(credit)) credit = "Anonymous";

    var id = Guid.NewGuid().ToString();
    var ext = extensionMap.GetValueOrDefault(file.ContentType, ".jpg");
    var blobName = $"{id}{ext}";

    var container = blobService.GetBlobContainerClient(blobContainerName);
    await container.CreateIfNotExistsAsync();
    var blob = container.GetBlobClient(blobName);

    using var stream = file.OpenReadStream();
    await blob.UploadAsync(stream, new Azure.Storage.Blobs.Models.BlobHttpHeaders { ContentType = file.ContentType });

    var entity = new TableEntity("photo", id)
    {
        ["Credit"] = credit,
        ["OriginalFilename"] = file.FileName,
        ["BlobName"] = blobName,
        ["ContentType"] = file.ContentType,
        ["UploadedAt"] = DateTimeOffset.UtcNow
    };
    await table.CreateIfNotExistsAsync();
    await table.AddEntityAsync(entity);

    return Results.Ok(new { message = "Photo uploaded successfully", id });
});

app.Run();

record LoginRequest(string? Password);
record HeartRequest(string? VisitorId);
