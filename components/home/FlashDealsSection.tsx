"use client"

import { AdminService, where, orderBy } from "@/src/services"
import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Flame, Clock, ArrowRight, Zap } from "lucide-react"
import { formatPrice } from "@/lib/utils"
import { toDate } from "@/lib/toDate"
import { usePlatformSettings } from "@/hooks/usePlatformSettings"

interface FlashDeal {
  id: string
  listingId: string
  title: string
  image: string
  originalPrice: number
  dealPrice: number
  discountPercent: number
  endsAt: any
  sold: number
  stock: number
}

function useCountdown(endsAt: Date | null) {
  const [timeLeft, setTimeLeft] = useState("")

  useEffect(() => {
    if (!endsAt) return
    const tick = () => {
      const diff = endsAt.getTime() - Date.now()
      if (diff <= 0) { setTimeLeft("Ended"); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setTimeLeft(`${h}h ${m}m ${s}s`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [endsAt])

  return timeLeft
}

function DealCard({ deal }: { deal: FlashDeal }) {
  const endsAt = deal.endsAt ? toDate(deal.endsAt) : null
  const countdown = useCountdown(endsAt)
  const soldPct = Math.min(100, Math.round((deal.sold / deal.stock) * 100))

  return (
    <Link
      href={`/listings/${deal.listingId}`}
      className="group flex-shrink-0 w-44 sm:w-52 rounded-2xl overflow-hidden bg-card border border-border hover:border-primary/40 hover:shadow-lg transition-all"
    >
      <div className="relative h-36 bg-muted overflow-hidden">
        {deal.image ? (
          <Image src={deal.image} alt={deal.title} fill className="object-cover group-hover:scale-105 transition-transform duration-500" sizes="208px" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Zap className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}
        <div className="absolute top-2 left-2 bg-primary text-white text-[10px] font-black px-2 py-0.5 rounded-full">
          -{deal.discountPercent}%
        </div>
      </div>
      <div className="p-3 space-y-1.5">
        <p className="text-xs font-semibold line-clamp-2 leading-snug">{deal.title}</p>
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-black text-primary">{formatPrice(deal.dealPrice)}</span>
          <span className="text-[10px] text-muted-foreground line-through">{formatPrice(deal.originalPrice)}</span>
        </div>
        <div className="space-y-1">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${soldPct}%` }} />
          </div>
          <p className="text-[10px] text-muted-foreground">{deal.sold} sold · {deal.stock - deal.sold} left</p>
        </div>
        {countdown && (
          <div className="flex items-center gap-1 text-[10px] text-orange-500 font-medium">
            <Clock className="h-3 w-3" />{countdown}
          </div>
        )}
      </div>
    </Link>
  )
}

export function FlashDealsSection() {
  const { settings } = usePlatformSettings()
  const [deals, setDeals] = useState<FlashDeal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!settings.flashDealsEnabled) return
    const now = new Date()
    const unsub = AdminService.subscribeToCollection(
      "flashDeals",
      docs => {
        const active = (docs as any[])
          .filter(d => d.endsAt && toDate(d.endsAt) > now && d.stock > d.sold)
        setDeals(active)
        setLoading(false)
      },
      [where("status", "==", "active"), orderBy("endsAt", "asc")]
    )
    return unsub
  }, [settings.flashDealsEnabled])

  if (!settings.flashDealsEnabled) return null
  if (loading || deals.length === 0) return null

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-primary/10 rounded-lg">
            <Flame className="h-4 w-4 text-primary" />
          </div>
          <h2 className="text-base font-bold text-foreground">Flash Deals</h2>
          <span className="text-[10px] bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full animate-pulse">
            LIVE
          </span>
        </div>
        <Link href="/flash-deals" className="text-xs text-primary font-medium flex items-center gap-0.5">
          See all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
        {deals.map(deal => <DealCard key={deal.id} deal={deal} />)}
      </div>
    </section>
  )
}
