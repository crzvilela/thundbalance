import { useEffect, useState } from 'react'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const PLACE_QUERY = 'ThundBalance, Carrer de Pallars 286, Barcelona, Spain'
const ELFSIGHT_WIDGET_ID = 'ad21ff0a-7d99-486d-a394-b51a8007f2c6'

let placesLibraryPromise

function loadPlacesLibrary() {
  if (window.google?.maps?.importLibrary) {
    return window.google.maps.importLibrary('places')
  }

  if (!placesLibraryPromise) {
    placesLibraryPromise = new Promise((resolve, reject) => {
      let script = document.getElementById('google-maps-javascript-api')

      if (!script) {
        script = document.createElement('script')
        script.id = 'google-maps-javascript-api'
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&v=weekly&loading=async`
        script.async = true
        script.defer = true
      }

      script.addEventListener('load', async () => {
        try {
          resolve(await window.google.maps.importLibrary('places'))
        } catch (error) {
          reject(error)
        }
      }, { once: true })
      script.addEventListener('error', () => reject(new Error('Google Maps could not be loaded.')), { once: true })

      if (window.google?.maps?.importLibrary) {
        window.google.maps.importLibrary('places').then(resolve, reject)
      } else if (!script.isConnected) {
        document.head.appendChild(script)
      }
    })
  }

  return placesLibraryPromise
}

function ElfsightReviews() {
  useEffect(() => {
    if (document.querySelector('script[src*="elfsightcdn.com/platform.js"]')) return

    const script = document.createElement('script')
    script.src = 'https://elfsightcdn.com/platform.js'
    script.async = true
    document.body.appendChild(script)
  }, [])

  return (
    <div className={`elfsight-app-${ELFSIGHT_WIDGET_ID}`} data-elfsight-app-lazy />
  )
}

export default function GoogleReviews() {
  const [placeId, setPlaceId] = useState('')
  const [useElfsight, setUseElfsight] = useState(!GOOGLE_MAPS_API_KEY)

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) return

    let cancelled = false
    const cacheKey = 'thundbalance-google-reviews-place-id'

    const findPlace = async () => {
      const { Place } = await loadPlacesLibrary()
      let resolvedPlaceId = sessionStorage.getItem(cacheKey)

      if (!resolvedPlaceId) {
        const { places } = await Place.searchByText({
          textQuery: PLACE_QUERY,
          fields: ['id'],
          language: 'en',
          region: 'ES',
          maxResultCount: 1,
          locationBias: { lat: 41.404704, lng: 2.2027016 }
        })
        resolvedPlaceId = places?.[0]?.id
        if (!resolvedPlaceId) throw new Error('ThundBalance was not found on Google Maps.')
        sessionStorage.setItem(cacheKey, resolvedPlaceId)
      }

      await customElements.whenDefined('gmp-place-details')
      if (!cancelled) setPlaceId(resolvedPlaceId)
    }

    findPlace().catch(() => {
      if (!cancelled) setUseElfsight(true)
    })

    return () => { cancelled = true }
  }, [])

  if (useElfsight) return <ElfsightReviews />

  if (!placeId) {
    return <div className="h-56 rounded-xl border border-white/10 bg-white/5 animate-pulse" aria-label="Loading Google reviews" />
  }

  return (
    <gmp-place-details
      className="block w-full"
      style={{
        width: '100%',
        '--gmp-mat-color-surface': '#111111',
        '--gmp-mat-color-on-surface': '#f5f5f5',
        '--gmp-mat-color-on-surface-variant': '#b0b0b0',
        '--gmp-mat-color-primary': '#34d399',
        '--gmp-mat-font-family': 'Inter, sans-serif',
        colorScheme: 'dark'
      }}
    >
      <gmp-place-details-place-request place={placeId} />
      <gmp-place-content-config>
        <gmp-place-rating />
        <gmp-place-reviews />
      </gmp-place-content-config>
    </gmp-place-details>
  )
}
