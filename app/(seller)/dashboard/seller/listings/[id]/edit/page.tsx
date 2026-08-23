"use client"

import { AdminService, ListingsService, where } from "@/src/services"
import { useEffect, useState, use } from "react"
import { useAuth } from "@/hooks/useAuth"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Loader2, ArrowLeft, Save, Layers, Plus, Trash2, Users, Package, Zap, Percent } from "lucide-react"
import { nigerianStates } from "@/constants/nigerianStates"
import { ShippingService, type ShippingMethodConfig } from "@/src/services"

const CONDITIONS = [
  { value: "brand_new", label: "Brand New" },
  { value: "open_box",  label: "Open Box" },
  { value: "grade_a",   label: "Grade A" },
  { value: "grade_b",   label: "Grade B" },
]

// Next.js 15+: params is a Promise — must be unwrapped with use()
export default function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user } = useAuth()
  const router = useRouter()
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [listing, setListing] = useState<any>(null)

  const [form, setForm] = useState({
    title: "", description: "", priceSale: "",
    priceRentDaily: "", condition: "brand_new",
    city: "", nigerianState: "", deliveryNationwide: false,
    stockQty: "", estimatedDeliveryDays: "",
    minOrderQty: "", unitOfSale: "piece", offersEnabled: true,
    lowStockThreshold: "",
  })
  // Standing discount — plain permanent price cut, no code/expiry. Kept
  // separate from `form` since discountPercent is only meaningful while
  // enabled is true (same pattern used for bulkPricing above).
  const [standingDiscountEnabled, setStandingDiscountEnabled] = useState(false)
  const [standingDiscountPercent, setStandingDiscountPercent] = useState("")
  // Delivery methods this listing offers — same shape as the posting flow's
  // Step5bShipment (shippingMethods array on the listing). Kept separate
  // from `form` since it's an array, not a scalar field.
  const [shippingMethods, setShippingMethods] = useState<("meetup" | "zamorax_logistics" | "fbz")[]>(["meetup"])
  const [shippingConfig, setShippingConfig] = useState<ShippingMethodConfig | null>(null)
  // FBZ ship-to-warehouse picker — only relevant once "fbz" is checked above
  // and the listing doesn't already have FBZ stock activated (listing.isFBZ).
  // Mirrors the create-listing flow's Step5bShipment fields.
  const [fbzWarehouseId, setFbzWarehouseId] = useState("")
  const [fbzQuantity, setFbzQuantity] = useState("")
  const [fbzNotes, setFbzNotes] = useState("")
  // Bulk pricing tiers — naira values as strings while editing, same
  // pattern as priceSale/priceRentDaily above. Converted to kobo on save.
  const [bulkPricing, setBulkPricing] = useState<{ minQty: string; price: string }[]>([])

  useEffect(() => {
    const load = async () => {
      const snap = await AdminService.getDoc("listings", id)
      if (!snap) { setLoading(false); return }
      const data = snap as any

      // Owners can edit their own listing; admin/moderator can edit any
      // listing for support/moderation purposes.
      const isStaff = user?.role === "admin" || user?.role === "moderator"
      if (data.sellerId !== user?.uid && !isStaff) { router.replace("/dashboard/seller/listings"); return }

      setListing(data)
      setShippingMethods(Array.isArray(data.shippingMethods) && data.shippingMethods.length > 0 ? data.shippingMethods : ["meetup"])
      setForm({
        title: data.title || "",
        description: data.description || "",
        priceSale: data.priceSale ? String(data.priceSale / 100) : "",
        priceRentDaily: data.priceRentDaily ? String(data.priceRentDaily / 100) : "",
        condition: data.condition || "brand_new",
        city: data.city || "",
        nigerianState: data.nigerianState || "",
        deliveryNationwide: data.deliveryNationwide || false,
        stockQty: data.stockQty != null ? String(data.stockQty) : "",
        estimatedDeliveryDays: data.estimatedDeliveryDays || "",
        minOrderQty: data.minOrderQty != null ? String(data.minOrderQty) : "",
        unitOfSale: data.unitOfSale || "piece",
        offersEnabled: data.offersEnabled !== false,
        lowStockThreshold: data.lowStockThreshold != null ? String(data.lowStockThreshold) : "",
      })
      setStandingDiscountEnabled(!!data.standingDiscount)
      setStandingDiscountPercent(data.standingDiscount?.discountPercent != null ? String(data.standingDiscount.discountPercent) : "")
      setBulkPricing(
        Array.isArray(data.bulkPricing)
          ? data.bulkPricing.map((t: { minQty: number; price: number }) => ({
              minQty: String(t.minQty),
              price: String(t.price / 100),
            }))
          : []
      )
      setLoading(false)
    }
    if (user?.uid) load()
  }, [id, user?.uid, router])

  // Admin-enabled delivery methods — same source Step5bShipment uses when
  // posting a new listing, so this edit form only offers methods admin
  // currently has switched on (e.g. hides FBZ entirely if fbzEnabled is off).
  useEffect(() => {
    ShippingService.getConfig().then(setShippingConfig)
  }, [])

  const handleSave = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast({ title: "Title and description are required", variant: "destructive" })
      return
    }
    if (standingDiscountEnabled && standingDiscountPercent.trim() === "") {
      toast({ title: "Enter a discount percentage", variant: "destructive" })
      return
    }
    // If seller just checked FBZ on a listing that isn't already FBZ-active,
    // a warehouse + quantity is required — same rule as the create-listing
    // form (Step5bShipment) — so the shipment request can be filed.
    const justAddingFbz = shippingMethods.includes("fbz") && !listing?.isFBZ
    if (justAddingFbz) {
      if (!fbzWarehouseId) {
        toast({ title: "Select a warehouse to send your FBZ stock to", variant: "destructive" })
        return
      }
      const qty = parseInt(fbzQuantity)
      if (!qty || qty < 1) {
        toast({ title: "Enter the quantity you'll send to the warehouse", variant: "destructive" })
        return
      }
    }
    setSaving(true)
    try {
      // A listing already has an FBZ shipment on file once it's been
      // through this flow before (pending intake, received-at-warehouse,
      // or already live) — re-filing on every edit was creating a second
      // fbzShipments row (and, once activated, a second "copy" of the
      // stock/listing) each time the seller saved changes. Look for any
      // existing non-terminal shipment tied to this listing first; only
      // file a brand-new one if none exists.
      let existingShipment: any = null
      if (justAddingFbz) {
        const rows = await AdminService.getCollection("fbzShipments", [
          where("listingId", "==", id),
        ])
        existingShipment = (rows as any[])
          .filter(r => !["rejected"].includes(r.status))
          .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())[0]
          ?? null
      }

      await ListingsService.updateListing(id, {
        title: form.title.trim(),
        description: form.description.trim(),
        priceSale: Math.round(parseFloat(form.priceSale || "0") * 100),
        priceRentDaily: form.priceRentDaily ? Math.round(parseFloat(form.priceRentDaily) * 100) : undefined,
        condition: form.condition as import("@/src/types").ListingCondition,
        city: form.city.trim(),
        nigerianState: form.nigerianState,
        deliveryNationwide: form.deliveryNationwide,
        shippingMethods: shippingMethods.length > 0 ? shippingMethods : ["meetup"],
        // Used/graded items are implicitly one-of-a-kind unless the seller
        // says otherwise — mirrors the same default applied at creation
        // time (see ListingForm/index.tsx). Only kicks in when stockQty
        // has never been set at all (listing.stockQty is null/undefined);
        // if it's already 0 (out of stock) or any other number, that's a
        // deliberate value and this leaves it untouched.
        stockQty: form.stockQty !== ""
          ? parseInt(form.stockQty)
          : (
              ["grade_a", "grade_b", "open_box"].includes(form.condition) && listing?.stockQty == null
                ? 1
                : undefined
            ),
        estimatedDeliveryDays: form.estimatedDeliveryDays.trim() || undefined,
        minOrderQty: form.minOrderQty.trim() !== "" ? parseInt(form.minOrderQty) : undefined,
        unitOfSale: form.unitOfSale || "piece",
        offersEnabled: form.offersEnabled,
        lowStockThreshold: form.lowStockThreshold.trim() !== "" ? parseInt(form.lowStockThreshold) : undefined,
        standingDiscount: standingDiscountEnabled && standingDiscountPercent.trim() !== ""
          ? { discountPercent: parseInt(standingDiscountPercent) }
          : null,
        bulkPricing: bulkPricing
          .filter(t => t.minQty.trim() !== "" && t.price.trim() !== "")
          .map(t => ({ minQty: parseInt(t.minQty), price: Math.round(parseFloat(t.price) * 100) })),
        // FBZ listings need stock confirmed at the warehouse in addition to
        // normal content review, so they hold at 'pending_fbz' instead of
        // the usual 'pending' — see manage-listings PATCH 'approve'.
        status: justAddingFbz ? "pending_fbz" : "pending",
      })

      // File the ship-to-warehouse request alongside the edit, same as the
      // create-listing flow — so the admin FBZ queue picks it up without
      // the seller needing a separate trip to /dashboard/fbz. If a shipment
      // already exists for this listing (pending, received, or active),
      // update it in place instead of filing a duplicate — one listing
      // should only ever have one shipment record.
      if (justAddingFbz) {
        const warehouse = shippingConfig?.fbzWarehouses.find(w => w.id === fbzWarehouseId)
        const payload = {
          sellerId:          user?.uid,
          sellerName:        user?.fullName || user?.email || null,
          sellerPhone:       (user as any)?.phone || null,
          listingId:         id,
          listingTitle:      form.title.trim(),
          listingImage:      listing?.images?.[0] || null,
          listingPrice:      Math.round(parseFloat(form.priceSale || "0") * 100),
          quantity:          parseInt(fbzQuantity),
          notes:             fbzNotes.trim() || null,
          warehouseId:       fbzWarehouseId,
          warehouseName:     warehouse?.name ?? null,
          warehouseCity:     warehouse?.city ?? null,
          warehouseState:    warehouse?.state ?? null,
        }
        if (existingShipment) {
          // Re-submitting resets it back into the intake queue for a fresh
          // admin check, rather than silently keeping stale inspection data.
          await AdminService.updateDoc("fbzShipments", existingShipment.id, {
            ...payload,
            status: "pending",
            quantityAvailable: 0,
          })
        } else {
          await AdminService.addDoc("fbzShipments", {
            ...payload,
            quantityAvailable: 0,
            status: "pending",
          })
        }
      }

      toast({
        title: "Listing updated!",
        description: justAddingFbz
          ? "Pending admin approval and FBZ stock confirmation. We'll notify you once your listing is live."
          : "It's now back in the review queue and won't show on the storefront (including any stock you just added) until an admin re-approves it.",
        variant: "success",
      })
      router.push("/dashboard/seller/listings")
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    }
    setSaving(false)
  }

  if (loading) return (
    <div className="flex h-[60vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  )

  if (!listing) return (
    <div className="container py-16 text-center">
      <p>Listing not found.</p>
      <Button asChild variant="outline" className="mt-4">
        <a href="/dashboard/seller/listings">Back to Listings</a>
      </Button>
    </div>
  )

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  return (
    <div className="container max-w-2xl py-8 pb-24 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-heading font-bold">Edit Listing</h1>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        ⚠️ Edited listings go back to <strong>pending review</strong> before going live again.
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Basic Info</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={form.title} onChange={set("title")} placeholder="Listing title" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <textarea
              value={form.description}
              onChange={set("description")}
              placeholder="Describe your item..."
              rows={5}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary min-h-[120px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Condition</Label>
            <Select value={form.condition} onValueChange={v => setForm(f => ({ ...f, condition: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONDITIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Pricing</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Sale Price (₦)</Label>
            <Input type="number" value={form.priceSale} onChange={set("priceSale")} placeholder="e.g. 50000" />
          </div>
          {listing.listingType !== "sale" && (
            <div className="space-y-1.5">
              <Label>Daily Rental Price (₦)</Label>
              <Input type="number" value={form.priceRentDaily} onChange={set("priceRentDaily")} placeholder="e.g. 5000" />
            </div>
          )}

          {/* Standing discount — plain permanent price cut, no code, no
              timer. Shows to buyers as a struck-through price, nothing
              labeled "discount" or "flash deal". */}
          <div className="rounded-xl border border-border/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="flex items-center gap-2">
                  <Percent className="h-4 w-4 text-primary" />
                  Price Cut <span className="text-muted-foreground text-xs">(optional)</span>
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Show a lower price right away — no code, no timer.
                </p>
              </div>
              <Switch
                checked={standingDiscountEnabled}
                onCheckedChange={(v) => {
                  setStandingDiscountEnabled(v)
                  if (!v) setStandingDiscountPercent("")
                }}
              />
            </div>
            {standingDiscountEnabled && (
              <div className="space-y-1.5">
                <Label className="text-xs">Discount percentage</Label>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={standingDiscountPercent}
                  onChange={(e) => setStandingDiscountPercent(e.target.value)}
                  placeholder="e.g. 5"
                />
                {standingDiscountPercent.trim() !== "" && form.priceSale.trim() !== "" && (
                  <p className="text-xs text-muted-foreground">
                    Buyers will see ₦{Math.round(parseFloat(form.priceSale) * (1 - parseInt(standingDiscountPercent || "0") / 100)).toLocaleString()} instead of ₦{Number(form.priceSale).toLocaleString()}.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Stock Quantity <span className="text-muted-foreground text-xs">(leave blank for unlimited)</span></Label>
            <Input
              type="number"
              min={1}
              value={form.stockQty}
              onChange={set("stockQty")}
              placeholder="e.g. 3"
            />
            {listing.stockQty === 0 && (
              <p className="text-xs text-red-500">⚠️ Currently out of stock. Enter a quantity to reactivate.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Low Stock Alert Threshold <span className="text-muted-foreground text-xs">(optional, default 3)</span></Label>
            <Input
              type="number"
              min={0}
              value={form.lowStockThreshold}
              onChange={set("lowStockThreshold")}
              placeholder="e.g. 3"
            />
            <p className="text-xs text-muted-foreground">
              We'll flag this listing on your dashboard once stock falls to or below this number.
            </p>
          </div>

          {/* Bulk / quantity pricing — seller-defined tiers, add/remove freely */}
          <div className="space-y-2 pt-2 border-t">
            <Label className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Bulk Pricing <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <p className="text-xs text-muted-foreground">
              Offer a lower price per piece when buyers order in bulk, e.g. ≥5 pieces.
            </p>
            {bulkPricing.map((tier, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Min. quantity</Label>
                  <Input
                    type="number"
                    min={2}
                    placeholder="e.g. 5"
                    value={tier.minQty}
                    onChange={e => setBulkPricing(rows => rows.map((r, i) => i === index ? { ...r, minQty: e.target.value } : r))}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Price per piece (₦)</Label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="e.g. 22,500"
                    value={tier.price}
                    onChange={e => setBulkPricing(rows => rows.map((r, i) => i === index ? { ...r, price: e.target.value } : r))}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive shrink-0"
                  onClick={() => setBulkPricing(rows => rows.filter((_, i) => i !== index))}
                  aria-label="Remove tier"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setBulkPricing(rows => [...rows, { minQty: "", price: "" }])}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Add price tier
            </Button>
          </div>

          {/* Minimum order quantity + unit of sale (optional) */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t">
            <div className="space-y-1.5">
              <Label className="text-xs">Min. Order Qty <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                type="number"
                min={1}
                placeholder="No minimum"
                value={form.minOrderQty}
                onChange={set("minOrderQty")}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Unit of Sale</Label>
              <Select value={form.unitOfSale} onValueChange={v => setForm(f => ({ ...f, unitOfSale: v }))}>
                <SelectTrigger><SelectValue placeholder="Piece" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="piece">Piece</SelectItem>
                  <SelectItem value="bag">Bag</SelectItem>
                  <SelectItem value="carton">Carton</SelectItem>
                  <SelectItem value="pack">Pack</SelectItem>
                  <SelectItem value="dozen">Dozen</SelectItem>
                  <SelectItem value="kg">Kg</SelectItem>
                  <SelectItem value="litre">Litre</SelectItem>
                  <SelectItem value="unit">Unit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Allow buyer offers toggle (optional, defaults ON) */}
          <div className="flex items-center justify-between rounded-lg border border-border/60 p-3 mt-2">
            <div>
              <Label className="text-sm">Allow Buyer Offers</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Switch off if you only want fixed-price sales.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.offersEnabled}
              onClick={() => setForm(f => ({ ...f, offersEnabled: !f.offersEnabled }))}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                form.offersEnabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  form.offersEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Location</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>City</Label>
            <Input value={form.city} onChange={set("city")} placeholder="e.g. Lagos Island" />
          </div>
          <div className="space-y-1.5">
            <Label>State</Label>
            <Select value={form.nigerianState} onValueChange={v => setForm(f => ({ ...f, nigerianState: v }))}>
              <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent>
                {nigerianStates.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.deliveryNationwide}
              onChange={e => setForm(f => ({ ...f, deliveryNationwide: e.target.checked }))}
              className="rounded" />
            <span className="text-sm">Deliver nationwide</span>
          </label>

          <div className="space-y-1.5">
            <Label>Delivery Methods</Label>
            <p className="text-xs text-muted-foreground">Choose how buyers can receive this item. You can only pick one method.</p>
            <div className="space-y-2 pt-1">
              {shippingConfig?.meetupEnabled !== false && (
                <label className="flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer hover:border-primary/40">
                  <input
                    type="radio"
                    name="shippingMethod"
                    checked={shippingMethods.includes("meetup")}
                    onChange={() => setShippingMethods(["meetup"])}
                    className="mt-0.5"
                  />
                  <div className="flex items-start gap-2">
                    <Users className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Safe Meet Up</p>
                      <p className="text-xs text-muted-foreground">Buyer meets you at a safe public spot. Free.</p>
                    </div>
                  </div>
                </label>
              )}
              {shippingConfig?.zlaEnabled && (
                <label className="flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer hover:border-primary/40">
                  <input
                    type="radio"
                    name="shippingMethod"
                    checked={shippingMethods.includes("zamorax_logistics")}
                    onChange={() => setShippingMethods(["zamorax_logistics"])}
                    className="mt-0.5"
                  />
                  <div className="flex items-start gap-2">
                    <Package className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">ZamoraxLogic Delivery</p>
                      <p className="text-xs text-muted-foreground">Drop parcel at nearest agent — delivered anywhere in Nigeria.</p>
                    </div>
                  </div>
                </label>
              )}
              {shippingConfig?.fbzEnabled && (
                <label className="flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer hover:border-primary/40">
                  <input
                    type="radio"
                    name="shippingMethod"
                    checked={shippingMethods.includes("fbz")}
                    onChange={() => setShippingMethods(["fbz"])}
                    className="mt-0.5"
                  />
                  <div className="flex items-start gap-2">
                    <Zap className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Fulfilled by Zamorax</p>
                      <p className="text-xs text-muted-foreground">
                        Only offered to buyers once your stock is verified at a Zamorax warehouse.
                      </p>
                    </div>
                  </div>
                </label>
              )}

              {/* Warehouse + quantity picker — only needed when FBZ was just
                  checked and this listing doesn't already have FBZ stock
                  activated. If it's already FBZ-active, no new shipment is
                  needed here. */}
              {shippingMethods.includes("fbz") && !listing?.isFBZ && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-3 ml-1">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Send stock to which warehouse?</Label>
                    {(shippingConfig?.fbzWarehouses ?? []).filter(w => w.acceptingStock).length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">
                        No warehouse is currently accepting stock — you can still save with FBZ
                        checked, but ship-to-warehouse will need to wait until one opens.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {(shippingConfig?.fbzWarehouses ?? []).filter(w => w.acceptingStock).map(w => (
                          <div
                            key={w.id}
                            onClick={() => setFbzWarehouseId(w.id)}
                            className={`flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-2 border cursor-pointer ${
                              fbzWarehouseId === w.id ? "border-amber-500 bg-amber-100/60" : "border-border bg-white hover:border-amber-300"
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-foreground truncate">{w.name}</p>
                              <p className="text-muted-foreground">{w.city}, {w.state}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Quantity you'll send</Label>
                    <Input
                      type="number"
                      min={1}
                      placeholder="e.g. 15"
                      value={fbzQuantity}
                      onChange={e => setFbzQuantity(e.target.value)}
                      className="max-w-[160px]"
                    />
                    <p className="text-xs text-muted-foreground">
                      No fixed minimum or maximum — admin confirms the actual count on arrival.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Notes for warehouse team (optional)</Label>
                    <Input
                      placeholder="e.g. All items are sealed, accessories included..."
                      value={fbzNotes}
                      onChange={e => setFbzNotes(e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-amber-700">
                    This listing won't go live until admin confirms your stock has arrived and
                    activates it — this is in addition to the normal listing review.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Estimated Delivery Time <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              value={form.estimatedDeliveryDays}
              onChange={set("estimatedDeliveryDays")}
              placeholder="e.g. 2-4 days"
              maxLength={20}
              className="max-w-[200px]"
            />
            <p className="text-xs text-muted-foreground">
              Shown to buyers on your listing as a fast-delivery trust signal.
            </p>
          </div>
        </CardContent>
      </Card>

      <Button
        className="w-full bg-primary text-white hover:bg-primary/90 h-12"
        onClick={handleSave}
        disabled={saving}
      >
        {saving
          ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving...</>
          : <><Save className="h-4 w-4 mr-2" /> Save Changes</>}
      </Button>
    </div>
  )
}
