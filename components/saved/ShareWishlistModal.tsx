"use client"

import { AdminService , serverTimestamp } from "@/src/services"
// components/saved/ShareWishlistModal.tsx

import { useState } from "react"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/components/ui/use-toast"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Share2, Copy, Check, Loader2, Globe } from "lucide-react"
import { setDoc } from "@/src/services"

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  listingIds: string[]
  /** Optional display name for the list */
  listName?: string
}

export function ShareWishlistModal({ open, onOpenChange, listingIds, listName }: Props) {
  const { user } = useAuth()
  const { toast } = useToast()

  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleGenerate = async () => {
    if (!user?.uid || listingIds.length === 0) return
    setGenerating(true)
    try {
      // Create a shareable snapshot in Firestore
      const shareId = `${user.uid.slice(0, 6)}-${Date.now().toString(36)}`
      await AdminService.setDoc("sharedWishlists", shareId, {
        ownerId: user.uid,
        ownerName: user.fullName || user.storeName || "A Zamorax user",
        listName: listName || "My Wishlist",
        listingIds,
        createdAt: serverTimestamp(),
        // Expires after 30 days — enforced by Firestore TTL policy on `expiresAt`
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })

      const url = `${process.env.NEXT_PUBLIC_APP_URL || "https://zamorax.com"}/wishlist/${shareId}`
      setShareUrl(url)
    } catch {
      toast({ title: "Could not generate link", variant: "destructive" })
    } finally { setGenerating(false) }
  }

  const handleCopy = async () => {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    toast({ title: "Link copied!", variant: "success" })
    setTimeout(() => setCopied(false), 2000)
  }

  const handleNativeShare = async () => {
    if (!shareUrl) return
    if (navigator.share) {
      await navigator.share({
        title: listName || "My Zamorax Wishlist",
        text: "Check out the items I saved on Zamorax!",
        url: shareUrl,
      })
    } else {
      handleCopy()
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    setShareUrl(null)
    setCopied(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" /> Share Wishlist
          </DialogTitle>
          <DialogDescription>
            Share your saved items with friends or family.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Item count summary */}
          <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2.5">
            <Globe className="h-4 w-4 text-primary shrink-0" />
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{listingIds.length}</span>{" "}
              saved item{listingIds.length !== 1 ? "s" : ""} will be shared
            </p>
          </div>

          {!shareUrl ? (
            <Button
              className="w-full bg-primary text-white hover:bg-primary/90"
              onClick={handleGenerate}
              disabled={generating || listingIds.length === 0}
            >
              {generating
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating link...</>
                : <><Share2 className="h-4 w-4 mr-2" /> Generate Shareable Link</>
              }
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={shareUrl}
                  readOnly
                  className="text-xs font-mono bg-muted border-muted"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleCopy}
                  className={copied ? "border-emerald-500 text-emerald-600" : ""}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>

              <Button
                className="w-full bg-primary text-white hover:bg-primary/90"
                onClick={handleNativeShare}
              >
                <Share2 className="h-4 w-4 mr-2" /> Share
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                This link is valid for 30 days.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
