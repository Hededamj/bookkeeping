import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Create client lazily to avoid build-time errors when env vars are not set
let _supabase: SupabaseClient | null = null

function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseKey) {
    return null
  }
  if (!_supabase) {
    _supabase = createClient(supabaseUrl, supabaseKey)
  }
  return _supabase
}

export const RECEIPTS_BUCKET = 'receipts'

export async function uploadReceiptImage(
  companyId: string,
  fileName: string,
  buffer: Buffer,
  mimeType: string
): Promise<{ url: string | null; error: string | null }> {
  const supabase = getSupabaseClient()

  if (!supabase) {
    return { url: null, error: 'Supabase ikke konfigureret' }
  }

  const fileExt = fileName.split('.').pop() || 'jpg'
  const uniqueName = `${companyId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`

  const { data, error } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .upload(uniqueName, buffer, {
      contentType: mimeType,
      upsert: false,
    })

  if (error) {
    console.error('Supabase upload error:', error)
    return { url: null, error: error.message }
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from(RECEIPTS_BUCKET)
    .getPublicUrl(data.path)

  return { url: urlData.publicUrl, error: null }
}

export async function deleteReceiptImage(imageUrl: string): Promise<boolean> {
  const supabase = getSupabaseClient()

  if (!supabase) {
    return false
  }

  // Extract path from URL
  const urlParts = imageUrl.split(`${RECEIPTS_BUCKET}/`)
  if (urlParts.length < 2) return false

  const path = urlParts[1]

  const { error } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .remove([path])

  if (error) {
    console.error('Supabase delete error:', error)
    return false
  }

  return true
}

// Check if Supabase is properly configured
export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseKey)
}
