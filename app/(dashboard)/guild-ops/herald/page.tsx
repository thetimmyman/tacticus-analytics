import { redirect } from 'next/navigation'

export const metadata = {
  title: 'Herald Role Pings | Boss Playbooks',
  description: 'Herald role-ping configuration lives in Boss Playbooks.'
}

export default function HeraldPage() {
  redirect('/boss-playbooks')
}
