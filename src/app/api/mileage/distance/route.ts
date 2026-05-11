import { NextRequest, NextResponse } from 'next/server'
import { getCompanyContext } from '@/lib/company'
import { getSettings } from '@/lib/settings'

// Auto-calculates driving distance via Google Distance Matrix API. Reuses the
// same googleCloudKey already used for Vision OCR - the user just needs to
// enable "Distance Matrix API" on the same Google Cloud project.
export async function GET(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const origin = searchParams.get('from')
  const destination = searchParams.get('to')

  if (!origin || !destination) {
    return NextResponse.json({ error: 'Missing from/to' }, { status: 400 })
  }

  const settings = await getSettings(context.companyId)
  const apiKey = settings.googleCloudKey
  if (!apiKey) {
    return NextResponse.json({ error: 'Google Cloud API-nøgle mangler' }, { status: 400 })
  }

  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json')
  url.searchParams.set('origins', origin)
  url.searchParams.set('destinations', destination)
  url.searchParams.set('mode', 'driving')
  url.searchParams.set('language', 'da')
  url.searchParams.set('region', 'dk')
  url.searchParams.set('key', apiKey)

  const response = await fetch(url.toString())
  const data = await response.json()

  if (data.status !== 'OK') {
    return NextResponse.json(
      { error: data.error_message || `Distance Matrix error: ${data.status}` },
      { status: 502 }
    )
  }

  const element = data.rows?.[0]?.elements?.[0]
  if (!element || element.status !== 'OK') {
    return NextResponse.json(
      { error: `Kunne ikke beregne afstand: ${element?.status || 'ukendt fejl'}` },
      { status: 422 }
    )
  }

  // element.distance.value is in meters
  const km = element.distance.value / 1000
  return NextResponse.json({
    km: Math.round(km * 10) / 10,
    durationSeconds: element.duration?.value,
    durationText: element.duration?.text,
    distanceText: element.distance.text,
  })
}
