import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'

export const GET = withAdminGuards({ guard: 'app-admin' }, async () => {
  const supabase = await db()

  const { data: items, error } = await supabase
    .from('carousel_items')
    .select('*')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    throw Errors.database(error.message)
  }

  return NextResponse.json({ items: items || [] })
})

export const POST = withAdminGuards(
  { guard: 'app-admin' },
  async (request: NextRequest, _context, { user }) => {
    const supabase = await db()
    const body = await request.json()

    const { data: item, error } = await supabase
      .from('carousel_items')
      .insert({
        title: body.title,
        description: body.description,
        image_url: body.image_url,
        link_url: body.link_url,
        link_text: body.link_text || 'Learn More',
        item_type: body.item_type || 'news',
        promo_code: body.promo_code,
        background_color: body.background_color || '#1a1a2e',
        text_color: body.text_color || '#ffffff',
        accent_color: body.accent_color || '#e94560',
        is_active: body.is_active ?? true,
        priority: body.priority || 0,
        starts_at: body.starts_at,
        expires_at: body.expires_at,
        created_by: user.id
      })
      .select()
      .single()

    if (error) {
      throw Errors.database(error.message)
    }

    return NextResponse.json({ item })
  }
)
