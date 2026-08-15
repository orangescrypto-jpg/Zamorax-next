"use client"
// components/chat/ChatWindow.tsx
// WhatsApp-style: fills parent height, messages always scroll to bottom

import { useRef, useEffect, useState } from "react"
import Image from "next/image"
import { useChat } from "@/hooks/useChat"
import { MessageBubble } from "./MessageBubble"
import { ChatLockNotice } from "./ChatLockNotice"
import { SafeMeetModal } from "./SafeMeetModal"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Send, Loader2, Shield, Tag } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { usePlatformSettings } from "@/hooks/usePlatformSettings"
import { ChatService } from "@/src/services/chat"
import { ListingsService } from "@/src/services/listings"
import { AdminService } from "@/src/services"
import { formatPrice } from "@/lib/utils"
import Link from "next/link"
import type { Chat, Listing } from "@/src/types"

interface ChatWindowProps {
  chatId: string
  userId: string
  receiverName: string
  chat: Chat
}

export function ChatWindow({ chatId, userId, receiverName, chat }: ChatWindowProps) {
  const { messages, loading, sendMessage, escrowFunded } = useChat(chatId, userId)
  const { settings } = usePlatformSettings()
  const [input,        setInput]        = useState("")
  const [sending,      setSending]      = useState(false)
  const [safeMeetOpen, setSafeMeetOpen] = useState(false)
  const [offerOpen,    setOfferOpen]    = useState(false)
  const [offerAmount,  setOfferAmount]  = useState("")
  const [sendingOffer, setSendingOffer] = useState(false)
  const [attachOpen,   setAttachOpen]   = useState(false)
  const [attachQuery,  setAttachQuery]  = useState("")
  const [attachResults, setAttachResults] = useState<Listing[]>([])
  const [attaching,    setAttaching]    = useState(false)
  const [attachedListing, setAttachedListing] = useState<{ id: string; title: string; image?: string; price?: number } | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollRef      = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  const isSeller = chat.sellerId === userId

  // FIX: scroll to bottom — use scrollTop directly, not scrollIntoView
  // scrollIntoView can mis-fire when the scroll container isn't the viewport
  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior })
    }
  }

  // Jump instantly on first load
  useEffect(() => {
    if (!loading && messages.length > 0) {
      scrollToBottom("instant")
    }
  }, [loading])

  // Smooth scroll on every new message
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom("smooth")
    }
  }, [messages])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || sending) return
    setSending(true)
    try {
      await sendMessage(input)
      setInput("")
    } catch (err: any) {
      toast({ title: "Message Blocked", description: err.message, variant: "destructive" })
    } finally { setSending(false) }
  }

  const effectiveListingId    = chat.listingId    || attachedListing?.id
  const effectiveListingTitle = chat.listingTitle || attachedListing?.title
  const effectiveListingImage = chat.listingImage || attachedListing?.image
  const effectiveListingPrice = attachedListing?.price ?? (chat as any).listingPrice ?? 0

  const handleSearchListings = async (q: string) => {
    setAttachQuery(q)
    if (!q.trim()) { setAttachResults([]); return }
    try {
      // Scoped to this chat's seller — whoever searches (buyer or seller),
      // results must only ever be listings owned by chat.sellerId. Without
      // this, the search hit every active listing platform-wide and a
      // seller with many listings (or a buyer) could attach the wrong one.
      const res = await ListingsService.getListings({ q: q.trim(), sellerId: chat.sellerId ?? "" })
      setAttachResults(res.items.slice(0, 8))
    } catch { setAttachResults([]) }
  }

  const handleAttachListing = async (listing: Listing) => {
    setAttaching(true)
    try {
      await AdminService.updateDoc("chats", chatId, {
        listingId:    listing.id,
        listingTitle: listing.title,
        listingImage: listing.images?.[0] || null,
      })
      setAttachedListing({ id: listing.id, title: listing.title, image: listing.images?.[0], price: listing.priceSale ?? 0 })
      setAttachOpen(false)
      setAttachQuery("")
      setAttachResults([])
      toast({ title: "Listing attached", description: listing.title, variant: "success" })
    } catch (e: any) {
      toast({ title: "Could not attach listing", description: e.message, variant: "destructive" })
    } finally { setAttaching(false) }
  }

  const handleSendOffer = async () => {
    const amountKobo = Math.round(parseFloat(offerAmount || "0") * 100)
    if (amountKobo <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return }
    if (!effectiveListingId || !effectiveListingTitle) { toast({ title: "No listing linked to this chat", variant: "destructive" }); return }

    setSendingOffer(true)
    try {
      await ChatService.sendOfferMessage(chatId, userId, {
        offerAmount:   amountKobo,
        originalPrice: effectiveListingPrice,
        listingId:     effectiveListingId,
        listingTitle:  effectiveListingTitle,
        listingImage:  effectiveListingImage,
        buyerId:       chat.buyerId ?? userId,
        buyerName:     chat.buyerName ?? "Buyer",
        sellerId:      chat.sellerId ?? "",
        sellerName:    chat.sellerName ?? "Seller",
      })
      toast({ title: "Offer sent 🎉", description: "The seller can accept or decline directly in chat.", variant: "success" })
      setOfferOpen(false)
      setOfferAmount("")
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setSendingOffer(false) }
  }

  if (loading) return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="animate-spin text-primary h-8 w-8" />
    </div>
  )

  return (
    <div className="flex flex-col flex-1 bg-background overflow-hidden">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b bg-muted/20 flex justify-between items-center shrink-0">
        <h3 className="font-semibold text-sm">Chat with {receiverName}</h3>
        <div className="flex items-center gap-2">
          {!isSeller && (effectiveListingId || effectiveListingTitle) && settings.offersEnabled && (
            <Button
              size="sm" variant="outline"
              className="text-xs border-primary/40 text-primary hover:bg-primary/5 h-8"
              onClick={() => setOfferOpen(true)}
            >
              <Tag className="h-3 w-3 mr-1" /> Send Offer
            </Button>
          )}
          {!effectiveListingId && !effectiveListingTitle && (
            <Button
              size="sm" variant="outline"
              className="text-xs border-primary/40 text-primary hover:bg-primary/5 h-8"
              onClick={() => setAttachOpen(true)}
            >
              <Tag className="h-3 w-3 mr-1" /> Attach Listing
            </Button>
          )}
          {settings.safeMeetEnabled && (
            <Button
              size="sm" variant="outline"
              className="text-xs border-primary/40 text-primary hover:bg-primary/5 h-8"
              onClick={() => setSafeMeetOpen(true)}
            >
              <Shield className="h-3 w-3 mr-1" /> Safe Meet
            </Button>
          )}
          {!escrowFunded && (
            <span className="text-xs bg-warning/20 text-warning px-2 py-1 rounded font-medium">
              Escrow Pending
            </span>
          )}
        </div>
      </div>

      {/* ── Messages ─────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-1 bg-muted/10"
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">No messages yet. Start the conversation!</p>
          </div>
        )}
        {messages.map(m => (
          <MessageBubble
            key={m.id}
            message={m}
            isOwn={m.senderId === userId}
            isSeller={isSeller}
            chatId={chatId}
            chat={chat}
          />
        ))}
        {/* Anchor kept as fallback */}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Security / lock notice ────────────────────────────────── */}
      {!escrowFunded && <ChatLockNotice />}

      {/* ── Attached listing card + Send Offer ──────────────────────── */}
      {(effectiveListingId || effectiveListingTitle) && (
        <div className="px-3 py-2 border-t bg-muted/30 flex items-center gap-3 shrink-0">
          {effectiveListingImage ? (
            <Image
              src={effectiveListingImage}
              alt={effectiveListingTitle || "Listing"}
              width={40}
              height={40}
              className="h-10 w-10 rounded-md object-cover border bg-background shrink-0"
            />
          ) : (
            <div className="h-10 w-10 rounded-md border bg-background shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-primary font-medium leading-none mb-0.5">Attached listing</p>
            <p className="text-xs font-medium text-foreground truncate">{effectiveListingTitle || "Listing"}</p>
          </div>
          {!isSeller && settings.offersEnabled && (
            <Button
              size="sm"
              className="text-xs bg-primary text-white hover:bg-primary/90 h-8 shrink-0"
              onClick={() => setOfferOpen(true)}
            >
              <Tag className="h-3 w-3 mr-1" /> Send Offer
            </Button>
          )}
        </div>
      )}

      {/* ── Input bar ────────────────────────────────────────────── */}
      <form
        onSubmit={handleSend}
        className="px-3 py-2 border-t bg-background flex gap-2 items-end shrink-0"
      >
        <Textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={!escrowFunded ? "Fund escrow to unlock messaging..." : "Type a message..."}
          className="flex-1 resize-none min-h-[44px] max-h-28 text-sm"
          rows={1}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(e) }
          }}
        />
        <Button
          type="submit"
          disabled={sending || !input.trim()}
          className="h-10 w-10 shrink-0 flex items-center justify-center bg-primary hover:bg-primary/90 text-white rounded-full p-0"
        >
          {sending
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Send className="h-4 w-4" />
          }
        </Button>
      </form>

      {/* ── Modals ───────────────────────────────────────────────── */}
      {settings.safeMeetEnabled && (
        <SafeMeetModal
          chatId={chatId}
          userId={userId}
          open={safeMeetOpen}
          onClose={() => setSafeMeetOpen(false)}
        />
      )}

      <Dialog open={offerOpen} onOpenChange={v => { setOfferOpen(v); if (!v) setOfferAmount("") }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" /> Send an Offer
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Re: <span className="font-medium text-foreground">{effectiveListingTitle}</span>
            </p>
            <div className="space-y-1">
              <label className="text-sm font-medium">Your Offer (₦)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">₦</span>
                <Input
                  type="number"
                  value={offerAmount}
                  onChange={e => setOfferAmount(e.target.value)}
                  placeholder="0"
                  className="pl-7"
                  autoFocus
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The seller will see Accept / Decline buttons in chat. If accepted, you can Buy Now at this price.
            </p>
            <Button
              className="w-full bg-primary text-white"
              disabled={sendingOffer || !offerAmount || parseFloat(offerAmount) <= 0}
              onClick={handleSendOffer}
            >
              {sendingOffer && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Send Offer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Attach Listing dialog (for chats with no linked listing) ──── */}
      <Dialog open={attachOpen} onOpenChange={v => { setAttachOpen(v); if (!v) { setAttachQuery(""); setAttachResults([]) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" /> Attach a Listing
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={attachQuery}
              onChange={e => handleSearchListings(e.target.value)}
              placeholder="Search listings by title..."
              autoFocus
            />
            <div className="max-h-72 overflow-y-auto space-y-1">
              {attachResults.length === 0 && attachQuery.trim() && (
                <p className="text-xs text-muted-foreground text-center py-4">No listings found.</p>
              )}
              {attachResults.map(l => (
                <button
                  key={l.id}
                  disabled={attaching}
                  onClick={() => handleAttachListing(l)}
                  className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-muted/60 text-left disabled:opacity-50"
                >
                  {l.images?.[0] ? (
                    <Image src={l.images[0]} alt={l.title} width={36} height={36} className="h-9 w-9 rounded object-cover border shrink-0" />
                  ) : (
                    <div className="h-9 w-9 rounded border bg-muted shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{l.title}</p>
                    <p className="text-[11px] text-muted-foreground">{formatPrice(l.priceSale ?? 0)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
