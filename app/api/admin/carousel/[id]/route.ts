import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'

export const PUT = withAdminGuards(
  { guard: 'app-admin' },
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const supabase = await db()
    const body = await request.json()

    const { data: item, error } = await supabase
      .from('carousel_items')
      .update({
        title: body.title,
        description: body.description,
        image_url: body.image_url,
        link_url: body.link_url,
        link_text: body.link_text,
        item_type: body.item_type,
        promo_code: body.promo_code,
        background_color: body.background_color,
        text_color: body.text_color,
        accent_color: body.accent_color,
        is_active: body.is_active,
        priority: body.priority,
        starts_at: body.starts_at,
        expires_at: body.expires_at,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      throw Errors.database(error.message)
    }

    return NextResponse.json({ item })
  }
)

export const DELETE = withAdminGuards(
  { guard: 'app-admin' },
  async (
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params
    const supabase = await db()

    const { error } = await supabase
      .from('carousel_items')
      .delete()
      .eq('id', id)

    if (error) {
      throw Errors.database(error.message)
    }

    return NextResponse.json({ success: true })
  }
)
