"use client"
// components/media/MediaLibraryPicker.tsx
// Modal that lists a user's previously uploaded images (from media_library,
// written to on every successful upload — see Step4Media.tsx and
// BlogPostForm.tsx) so they can reuse a photo for a new listing or post
// instead of uploading the same file again.

import { useEffect, useState } from "react"
import { X, ImageIcon, Loader2, Check } from "lucide-react"
import { AdminService } from "@/src/services"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

interface MediaItem {
  id: string
  userId: string
  url: string
  path?: string | null
  fileName?: string | null
  context?: string | null
  createdAt?: string | null
}

interface MediaLibraryPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (url: string) => void
  // Optional multi-select mode — used by the listing form to add several
  // previously-uploaded photos at once.
  multiple?: boolean
  onSelectMultiple?: (urls: string[]) => void
  // Filter to a specific upload context, e.g. "listing" or "blog_cover".
  // Omitted = show everything the user has ever uploaded.
  context?: string
}

export function MediaLibraryPicker({
  open, onOpenChange, onSelect, multiple = false, onSelectMultiple, context,
}: MediaLibraryPickerProps) {
  const { user } = useAuth()
  const [items, setItems]     = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open || !user?.uid) return
    setLoading(true)
    setSelected(new Set())
    const constraints: any[] = [
      { field: "userId", op: "==", value: user.uid },
      { field: "createdAt", dir: "desc" },
      { limit: 100 },
    ]
    AdminService.getCollection("media_library", constraints)
      .then(docs => {
        let rows = docs as unknown as MediaItem[]
        if (context) rows = rows.filter(r => r.context === context)
        setItems(rows)
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [open, user?.uid, context])

  if (!open) return null

  const toggleSelect = (url: string) => {
    if (!multiple) {
      onSelect(url)
      onOpenChange(false)
      return
    }
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const confirmMultiple = () => {
    onSelectMultiple?.(Array.from(selected))
    onOpenChange(false)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl bg-white sm:rounded-2xl rounded-t-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="font-semibold text-sm">My uploads</h3>
            <p className="text-xs text-muted-foreground">Reuse a photo you've uploaded before</p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
              <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No uploads yet</p>
              <p className="text-xs text-muted-foreground/70">Photos you upload will show up here for next time.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {items.map(item => {
                const isSelected = selected.has(item.url)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleSelect(item.url)}
                    className={cn(
                      "relative aspect-square rounded-lg overflow-hidden border-2 transition",
                      isSelected ? "border-primary" : "border-transparent hover:border-primary/40"
                    )}
                  >
                    <img src={item.url} alt={item.fileName || "Uploaded photo"} className="w-full h-full object-cover" />
                    {isSelected && (
                      <div className="absolute inset-0 bg-primary/30 flex items-center justify-center">
                        <div className="bg-primary text-white rounded-full p-1">
                          <Check className="h-3.5 w-3.5" />
                        </div>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {multiple && (
          <div className="px-4 py-3 border-t flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{selected.size} selected</span>
            <button
              onClick={confirmMultiple}
              disabled={selected.size === 0}
              className="text-sm font-medium bg-primary text-white px-4 py-1.5 rounded-lg disabled:opacity-40"
            >
              Add {selected.size > 0 ? selected.size : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
