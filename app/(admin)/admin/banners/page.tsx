"use client"

import {AdminService, where, orderBy, query, onSnapshot, serverTimestamp} from "@/src/services"
// app/(admin)/admin/banners/page.tsx
// Manage Featured Deal banners shown on the homepage PromoStrip.

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/hooks/useAuth"
import { StorageService } from "@/src/services"
import imageCompression from "browser-image-compression"
import { Loader2, Plus, Trash2, Save, GripVertical, Eye, EyeOff, ChevronUp, ChevronDown, Upload, X } from "lucide-react"

const COLOR_OPTIONS = [
  { value: "dark",   label: "Dark Navy",   preview: "from-[#1a1a2e] to-[#16213e]" },
  { value: "orange", label: "Orange",      preview: "from-orange-500 to-orange-700" },
  { value: "teal",   label: "Teal/Green",  preview: "from-teal-500 to-teal-700" },
  { value: "purple", label: "Purple",      preview: "from-violet-600 to-purple-700" },
  { value: "green",  label: "Emerald",     preview: "from-emerald-600 to-green-700" },
  { value: "red",    label: "Red",         preview: "from-red-600 to-rose-700" },
]

const ICON_OPTIONS = ["zap", "shield", "trending", "tag", "star", "flame"]

interface Banner {
  id: string
  tag: string
  title: string
  subtitle: string
  href: string
  imageUrl: string
  color: string
  icon: string
  active: boolean
  order: number
  createdAt?: string
}

const EMPTY_BANNER: Omit<Banner, "id"> = {
  tag: "HOT DEALS",
  title: "",
  subtitle: "",
  href: "/search",
  imageUrl: "",
  color: "dark",
  icon: "zap",
  active: true,
  order: 0 }

export default function AdminBannersPage() {
  const { toast } = useToast()
  const [banners, setBanners] = useState<Banner[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newBanner, setNewBanner] = useState({ ...EMPTY_BANNER })

  useEffect(() => {
    const q = AdminService._ref_("featuredBanners", [orderBy("order", "asc")])
    const unsub = onSnapshot(q, snap => {
      setBanners(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, ...d.data() } as Banner)))
      setLoading(false)
    })
    return unsub
  }, [])

  async function handleAdd() {
    // If an image is uploaded, it replaces the tag/title/colors/icon
    // entirely (see the "Banner image" hint text below) — so title is
    // only required when building a text-based banner with no image.
    if (!newBanner.imageUrl && !newBanner.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" })
      return
    }
    setSaving("new")
    try {
      await AdminService.addDoc("featuredBanners", {
        ...newBanner,
        order: banners.length,
        createdAt: serverTimestamp() })
      setNewBanner({ ...EMPTY_BANNER })
      setAdding(false)
      toast({ title: "Banner added ✅" })
    } catch {
      toast({ title: "Failed to add banner", variant: "destructive" })
    } finally {
      setSaving(null)
    }
  }

  async function handleUpdate(id: string, fields: Partial<Banner>) {
    setSaving(id)
    try {
      await AdminService.updateDoc("featuredBanners", id, { ...fields, updatedAt: serverTimestamp() })
      toast({ title: "Saved ✅" })
    } catch {
      toast({ title: "Failed to save", variant: "destructive" })
    } finally {
      setSaving(null)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this banner?")) return
    await AdminService.deleteDoc("featuredBanners", id)
    toast({ title: "Banner deleted" })
  }

  async function handleMove(id: string, direction: "up" | "down") {
    const idx = banners.findIndex(b => b.id === id)
    if (direction === "up" && idx === 0) return
    if (direction === "down" && idx === banners.length - 1) return
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    const a = banners[idx]
    const b = banners[swapIdx]
    await Promise.all([
      AdminService.updateDoc("featuredBanners", a.id, { order: b.order }),
      AdminService.updateDoc("featuredBanners", b.id, { order: a.order }),
    ])
  }

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  )

  return (
    <div className="container py-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Featured Banners</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            These appear as the "Featured Deals" cards on the homepage. Live changes in seconds.
          </p>
        </div>
        <Button onClick={() => setAdding(true)} className="bg-primary text-white gap-2">
          <Plus className="h-4 w-4" /> Add Banner
        </Button>
      </div>

      {/* Live preview note */}
      <div className="bg-accent/10 border border-accent/30 rounded-xl px-4 py-3 text-sm text-accent font-medium">
        ✅ Changes go live instantly — no redeploy needed.
      </div>

      {/* Add new banner form */}
      {adding && (
        <Card className="border-primary/30 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New Banner</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <BannerForm banner={newBanner} onChange={setNewBanner} />
            <div className="flex gap-2 pt-2">
              <Button onClick={handleAdd} disabled={saving === "new"} className="bg-primary text-white">
                {saving === "new" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Add Banner
              </Button>
              <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Existing banners */}
      {banners.length === 0 && !adding && (
        <div className="text-center py-16 text-muted-foreground">
          No banners yet. Click "Add Banner" to create the first one.
        </div>
      )}

      <div className="space-y-4">
        {banners.map((banner, idx) => (
          <BannerCard
            key={banner.id}
            banner={banner}
            isFirst={idx === 0}
            isLast={idx === banners.length - 1}
            saving={saving === banner.id}
            onSave={(fields) => handleUpdate(banner.id, fields)}
            onDelete={() => handleDelete(banner.id)}
            onMove={(dir) => handleMove(banner.id, dir)}
            onToggle={(active) => handleUpdate(banner.id, { active })}
          />
        ))}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BannerForm({
  banner,
  onChange }: {
  banner: Omit<Banner, "id">
  onChange: (b: Omit<Banner, "id">) => void
}) {
  const { toast } = useToast()
  const { user } = useAuth()
  const [uploading, setUploading] = useState(false)
  const set = (k: keyof Omit<Banner, "id">) => (v: unknown) => onChange({ ...banner, [k]: v })

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || !user?.uid) return
    setUploading(true)
    try {
      const raw = e.target.files[0]
      // These cards are small (~224px wide), so compress harder than the
      // full-width site banners — no need to keep them as large.
      const file = await imageCompression(raw, {
        maxSizeMB:        0.6,
        maxWidthOrHeight: 800,
        useWebWorker:     true,
        fileType:         "image/webp",
      })
      const path = `featured-banners/${user.uid}/${Date.now()}_${raw.name.replace(/\.[^/.]+$/, "")}.webp`
      const result = await StorageService.uploadFile(file, path)
      set("imageUrl")(result.url)
      toast({ title: "Image uploaded ✅" })
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message, variant: "destructive" })
    } finally {
      setUploading(false)
      e.target.value = ""
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Image upload: if set, the card renders as this image (linked to
          Link URL below) instead of the tag/title/subtitle/color card. ── */}
      <div className="space-y-1.5">
        <Label>Banner image (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Upload a pre-made card image (recommended ~600×450px) instead of building
          a text banner. If you upload one, it replaces the tag/title/colors/icon
          below — only the Link URL still applies.
        </p>

        {banner.imageUrl ? (
          <div className="relative rounded-lg border overflow-hidden w-56">
            <img src={banner.imageUrl} alt="Banner preview" className="w-full h-auto max-h-40 object-cover bg-muted" />
            <button
              type="button"
              onClick={() => set("imageUrl")("")}
              className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
              aria-label="Remove image"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg py-6 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors">
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : (
              <>
                <Upload className="h-6 w-6 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Click to upload an image</span>
              </>
            )}
            <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={handleImageUpload} />
          </label>
        )}
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${banner.imageUrl ? "opacity-50 pointer-events-none" : ""}`}>
        <div className="space-y-1.5">
          <Label>Tag label</Label>
          <Input placeholder="e.g. HOT DEALS" value={banner.tag} onChange={e => set("tag")(e.target.value.toUpperCase())} />
        </div>
        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input placeholder="e.g. Phones & Tablets" value={banner.title} onChange={e => set("title")(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Subtitle</Label>
          <Input placeholder="e.g. Up to 40% off verified phones" value={banner.subtitle} onChange={e => set("subtitle")(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Color theme</Label>
          <div className="flex flex-wrap gap-2">
            {COLOR_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set("color")(opt.value)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  banner.color === opt.value
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <span className={`w-4 h-4 rounded-full bg-gradient-to-br ${opt.preview} shrink-0`} />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Icon</Label>
          <div className="flex flex-wrap gap-2">
            {ICON_OPTIONS.map(ic => (
              <button
                key={ic}
                type="button"
                onClick={() => set("icon")(ic)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-all ${
                  banner.icon === ic
                    ? "bg-primary text-white border-primary"
                    : "border-border hover:border-primary/40"
                }`}
              >
                {ic}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Link URL {banner.imageUrl && "(still applies — the image will be clickable)"}</Label>
        <Input placeholder="/categories/phones-tablets" value={banner.href} onChange={e => set("href")(e.target.value)} />
      </div>
    </div>
  )
}

function BannerCard({
  banner, isFirst, isLast, saving,
  onSave, onDelete, onMove, onToggle }: {
  banner: Banner
  isFirst: boolean
  isLast: boolean
  saving: boolean
  onSave: (fields: Partial<Banner>) => void
  onDelete: () => void
  onMove: (dir: "up" | "down") => void
  onToggle: (active: boolean) => void
}) {
  const [draft, setDraft] = useState(banner)
  const isDirty = JSON.stringify(draft) !== JSON.stringify(banner)

  useEffect(() => { setDraft(banner) }, [banner])

  return (
    <Card className={`transition-all ${!banner.active ? "opacity-60" : ""}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Order controls */}
            <div className="flex flex-col gap-0.5">
              <button onClick={() => onMove("up")} disabled={isFirst} className="p-0.5 rounded hover:bg-muted disabled:opacity-20">
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => onMove("down")} disabled={isLast} className="p-0.5 rounded hover:bg-muted disabled:opacity-20">
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <div>
              <p className="font-semibold text-sm">{banner.title || "Untitled"}</p>
              <p className="text-xs text-muted-foreground">{banner.tag}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Active toggle */}
            <div className="flex items-center gap-1.5">
              {banner.active ? <Eye className="h-3.5 w-3.5 text-accent" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
              <Switch
                checked={banner.active}
                onCheckedChange={onToggle}
                className="scale-90"
              />
            </div>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <BannerForm banner={draft} onChange={(b) => setDraft(b as Banner)} />
        {isDirty && (
          <Button
            onClick={() => onSave(draft)}
            disabled={saving}
            className="bg-primary text-white gap-2"
            size="sm"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save changes
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
