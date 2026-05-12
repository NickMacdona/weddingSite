import { useState, useEffect, useRef, useCallback, forwardRef } from 'react'
import HTMLFlipBook from 'react-pageflip'

const API_BASE = 'https://wedding-photo-api.icysky-79d3c8ed.uksouth.azurecontainerapps.io'

function getVisitorId(): string {
  let id = localStorage.getItem('visitorId')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('visitorId', id)
  }
  return id
}

const visitorId = getVisitorId()

function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth <= 768)
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return mobile
}

interface Photo {
  id: string
  credit: string
  uploadedAt: string
  url: string
  hearts: number
  hearted: boolean
}

interface PhotosResponse {
  photos: Photo[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

const CoverPage = forwardRef<HTMLDivElement>((_, ref) => (
  <div ref={ref} style={styles.page}>
    <div style={styles.cover}>
      <p style={styles.coverPrelude}>The Wedding of</p>
      <h1 style={styles.coverTitle}>Mhairi <em style={styles.italic}>&</em> Barnaby</h1>
      <div style={styles.divider} />
      <p style={styles.coverSubtitle}>Our Photo Album</p>
    </div>
  </div>
))

interface PhotoPageProps {
  photo: Photo
  onHeart: (id: string) => void
}

const PhotoPage = forwardRef<HTMLDivElement, PhotoPageProps>(({ photo, onHeart }, ref) => (
  <div ref={ref} style={styles.page}>
    <img src={photo.url} alt={`Photo by ${photo.credit}`} style={styles.photo} />
    <div style={styles.creditBar}>
      <span style={styles.creditText}>{photo.credit}</span>
      <button
        style={styles.heartBtn}
        onClick={(e) => { e.stopPropagation(); onHeart(photo.id) }}
      >
        <span style={photo.hearted ? styles.heartFilled : styles.heartEmpty}>
          {photo.hearted ? '♥' : '♡'}
        </span>
        {photo.hearts > 0 && <span style={styles.heartCount}>{photo.hearts}</span>}
      </button>
    </div>
  </div>
))

const EndPage = forwardRef<HTMLDivElement>((_, ref) => (
  <div ref={ref} style={styles.page}>
    <div style={styles.cover}>
      <div style={styles.divider} />
      <p style={styles.endText}>With love and gratitude</p>
      <h2 style={styles.endTitle}>Mhairi & Barnaby</h2>
      <div style={styles.divider} />
    </div>
  </div>
))

function PhotoTile({ photo, onHeart }: PhotoPageProps) {
  return (
    <div style={styles.tile}>
      <img src={photo.url} alt={`Photo by ${photo.credit}`} style={styles.tileImg} />
      <div style={styles.tileOverlay}>
        <span style={styles.creditText}>{photo.credit}</span>
        <button
          style={styles.heartBtn}
          onClick={() => onHeart(photo.id)}
        >
          <span style={photo.hearted ? styles.heartFilled : styles.heartEmpty}>
            {photo.hearted ? '♥' : '♡'}
          </span>
          {photo.hearts > 0 && <span style={styles.heartCount}>{photo.hearts}</span>}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalPages, setTotalPages] = useState(0)
  const [loadedApiPages, setLoadedApiPages] = useState(0)
  const [currentFlipPage, setCurrentFlipPage] = useState(0)
  const fetchingRef = useRef(false)
  const isMobile = useIsMobile()

  const fetchPage = useCallback(async (page: number) => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      const res = await fetch(`${API_BASE}/api/photos?page=${page}&pageSize=20&visitorId=${visitorId}`)
      if (!res.ok) throw new Error('Failed to load photos')
      const data: PhotosResponse = await res.json()
      setPhotos(prev => [...prev, ...data.photos])
      setTotalPages(data.totalPages)
      setLoadedApiPages(page)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      fetchingRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPage(1) }, [fetchPage])

  useEffect(() => {
    if (!isMobile) {
      if (loadedApiPages < totalPages) {
        fetchPage(loadedApiPages + 1)
      }
      return
    }
    const photosOnLastLoadedPages = loadedApiPages * 20
    const threshold = photosOnLastLoadedPages - 5
    if (currentFlipPage >= threshold && loadedApiPages < totalPages) {
      fetchPage(loadedApiPages + 1)
    }
  }, [currentFlipPage, loadedApiPages, totalPages, fetchPage, isMobile])

  const handleHeart = useCallback(async (photoId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/photos/${photoId}/heart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId })
      })
      if (!res.ok) return
      const data: { hearted: boolean } = await res.json()
      setPhotos(prev => prev.map(p =>
        p.id === photoId
          ? { ...p, hearted: data.hearted, hearts: p.hearts + (data.hearted ? 1 : -1) }
          : p
      ))
    } catch { /* ignore */ }
  }, [])

  if (loading) {
    return (
      <div style={styles.wrapper}>
        <p style={styles.loadingText}>Loading album...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={styles.wrapper}>
        <p style={styles.errorText}>{error}</p>
      </div>
    )
  }

  if (photos.length === 0) {
    return (
      <div style={styles.wrapper}>
        <h1 style={styles.emptyTitle}>No photos yet</h1>
        <p style={styles.emptyText}>Photos will appear here once guests start uploading.</p>
      </div>
    )
  }

  if (!isMobile) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.desktopHeader}>
          <p style={styles.coverPrelude}>The Wedding of</p>
          <h1 style={styles.coverTitle}>Mhairi <em style={styles.italic}>&</em> Barnaby</h1>
          <div style={styles.divider} />
          <p style={styles.coverSubtitle}>Our Photo Album</p>
        </div>
        <div style={styles.tileGrid}>
          {photos.map(photo => (
            <PhotoTile key={photo.id} photo={photo} onHeart={handleHeart} />
          ))}
        </div>
        <a href="../index.html" style={styles.backLink}>&larr; Back to site</a>
      </div>
    )
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.bookContainer}>
        <HTMLFlipBook
          width={400}
          height={550}
          size="stretch"
          minWidth={280}
          maxWidth={600}
          minHeight={400}
          maxHeight={800}
          showCover={true}
          mobileScrollSupport={false}
          style={{}}
          className=""
          startPage={0}
          drawShadow={true}
          flippingTime={600}
          usePortrait={true}
          startZIndex={0}
          autoSize={true}
          maxShadowOpacity={0.3}
          useMouseEvents={true}
          swipeDistance={30}
          clickEventForward={true}
          showPageCorners={true}
          disableFlipByClick={false}
          onFlip={(e: { data: number }) => setCurrentFlipPage(e.data)}
        >
          <CoverPage />
          {photos.map(photo => (
            <PhotoPage key={photo.id} photo={photo} onHeart={handleHeart} />
          ))}
          <EndPage />
        </HTMLFlipBook>
      </div>
      <p style={styles.hint}>Swipe to flip pages</p>
      <a href="../index.html" style={styles.backLink}>&larr; Back to site</a>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100svh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem 1rem',
    fontFamily: "'Lato', sans-serif",
    background: '#FAFAFA',
    color: '#3E3E38',
  },
  desktopHeader: {
    textAlign: 'center' as const,
    marginBottom: '2.5rem',
  },
  bookContainer: {
    width: '100%',
    maxWidth: '600px',
    aspectRatio: '400 / 550',
  },
  page: {
    background: '#fff',
    overflow: 'hidden',
    position: 'relative',
  },
  cover: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '2rem',
    background: '#EDE8DF',
  },
  coverPrelude: {
    fontSize: 'clamp(0.8rem, 2vw, 1rem)',
    letterSpacing: '0.15em',
    textTransform: 'uppercase' as const,
    color: '#5E5E56',
    marginBottom: '1rem',
  },
  coverTitle: {
    fontFamily: "'Playfair Display', serif",
    fontWeight: 400,
    fontSize: 'clamp(1.8rem, 5vw, 2.8rem)',
    letterSpacing: '0.04em',
    marginBottom: '0.5em',
    textAlign: 'center' as const,
  },
  italic: {
    fontStyle: 'italic',
    color: '#C9A3A0',
  },
  coverSubtitle: {
    fontSize: 'clamp(0.8rem, 2vw, 1rem)',
    letterSpacing: '0.15em',
    textTransform: 'uppercase' as const,
    color: '#5E5E56',
  },
  divider: {
    width: 60,
    height: 1,
    background: '#A8B5A2',
    margin: '1.5rem auto',
  },
  photo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    display: 'block',
  },
  creditBar: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    background: 'linear-gradient(transparent, rgba(0,0,0,0.5))',
    padding: '2rem 1rem 0.8rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  creditText: {
    color: '#fff',
    fontSize: '0.8rem',
    letterSpacing: '0.06em',
    fontWeight: 300,
  },
  heartBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    padding: '0.4rem',
    WebkitTapHighlightColor: 'transparent',
  },
  heartEmpty: {
    fontSize: '1.4rem',
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 1,
  },
  heartFilled: {
    fontSize: '1.4rem',
    color: '#C9A3A0',
    lineHeight: 1,
  },
  heartCount: {
    color: '#fff',
    fontSize: '0.8rem',
    fontWeight: 300,
    letterSpacing: '0.04em',
  },
  tileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '1rem',
    width: '100%',
    maxWidth: '1000px',
    marginBottom: '2rem',
  },
  tile: {
    position: 'relative' as const,
    aspectRatio: '1',
    overflow: 'hidden',
    borderRadius: '2px',
    cursor: 'default',
  },
  tileImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    display: 'block',
    filter: 'saturate(0.85)',
    transition: 'transform 0.5s ease, filter 0.5s ease',
  },
  tileOverlay: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    background: 'linear-gradient(transparent, rgba(0,0,0,0.5))',
    padding: '2rem 0.8rem 0.6rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  endText: {
    fontSize: 'clamp(0.9rem, 2vw, 1.1rem)',
    color: '#5E5E56',
    fontWeight: 300,
    lineHeight: 1.8,
  },
  endTitle: {
    fontFamily: "'Playfair Display', serif",
    fontWeight: 400,
    fontSize: 'clamp(1.4rem, 4vw, 2rem)',
    color: '#3E3E38',
  },
  hint: {
    marginTop: '1.5rem',
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.15em',
    color: '#C4B9A0',
  },
  backLink: {
    marginTop: '1.5rem',
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.2em',
    color: '#5E5E56',
    textDecoration: 'none',
  },
  loadingText: {
    fontFamily: "'Playfair Display', serif",
    fontSize: '1.2rem',
    color: '#5E5E56',
  },
  errorText: {
    color: '#B48885',
    fontSize: '1rem',
  },
  emptyTitle: {
    fontFamily: "'Playfair Display', serif",
    fontWeight: 400,
    fontSize: 'clamp(1.4rem, 4vw, 2rem)',
    marginBottom: '0.5em',
  },
  emptyText: {
    color: '#5E5E56',
    fontSize: '1rem',
  },
}
