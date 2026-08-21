"use client"
// components/listings/ListingForm/Step4Media.tsx
// Reads maxImagesPerListing, videoUploadEnabled, maxVideoSizeMb, videoRequiredForPlan
// from config/platform (Firestore) — all controlled via Admin Settings.
// Falls back to safe defaults if the doc hasn't been saved yet.

import { useFormContext } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { X, Upload, Video, Loader2, CheckCircle, AlertCircle, Film, ImageIcon } from "lucide-react"
import { useState, useEffect } from "react"
import Image from "next/image"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/hooks/useAuth"
import { StorageService } from "@/src/services"
import { AdminService } from "@/src/services"
import { recordMediaUpload } from "@/lib/mediaLibrary"
import { MediaLibraryPicker } from "@/components/media/MediaLibraryPicker"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import imageCompression from "browser-image-compression"

// ─── Platform media limits (from config/platform) ────────────────────────────

interface MediaLimits {
  maxImagesPerListing: number
  videoUploadEnabled: boolean
  maxVideoSizeMb: number
  videoRequiredForPlan: "none" | "starter" | "pro"  // which plan tier requires a video
  allowedVideoTypes: string[]                         // e.g. ["video/mp4","video/quicktime"]
  videoMaxDurationSec: number                         // informational, shown to user
}

const MEDIA_DEFAULTS: MediaLimits = {
  maxImagesPerListing: 10,
  videoUploadEnabled: false,
  maxVideoSizeMb: 50,
  videoRequiredForPlan: "none",
  allowedVideoTypes: ["video/mp4", "video/quicktime", "video/webm"],
  videoMaxDurationSec: 60,
}

function useMediaLimits(): MediaLimits {
  const [limits, setLimits] = useState<MediaLimits>(MEDIA_DEFAULTS)

  useEffect(() => {
    AdminService.getDoc("config", "platform")
      .then(doc => {
        if (!doc) return
        setLimits({
          maxImagesPerListing:  (doc as any).maxImagesPerListing  ?? MEDIA_DEFAULTS.maxImagesPerListing,
          videoUploadEnabled:   (doc as any).videoUploadEnabled   ?? MEDIA_DEFAULTS.videoUploadEnabled,
          maxVideoSizeMb:       (doc as any).maxVideoSizeMb       ?? MEDIA_DEFAULTS.maxVideoSizeMb,
          videoRequiredForPlan: (doc as any).videoRequiredForPlan ?? MEDIA_DEFAULTS.videoRequiredForPlan,
          allowedVideoTypes:    (doc as any).allowedVideoTypes     ?? MEDIA_DEFAULTS.allowedVideoTypes,
          videoMaxDurationSec:  (doc as any).videoMaxDurationSec  ?? MEDIA_DEFAULTS.videoMaxDurationSec,
        })
      })
      .catch(() => {/* use defaults */})
  }, [])

  return limits
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Step4Media() {
  const { setValue, watch } = useFormContext()
  // Plain string array — managed directly via watch/setValue rather than
  // useFieldArray, since useFieldArray expects object entries and produces
  // an out-of-sync `fields` vs `watch()` result for primitive string arrays
  // (this was the root cause of thumbnails staying blank after upload).
  const imageValues: string[] = watch("images") || []
  const videoUrl: string | undefined = watch("verificationVideo")

  const appendImage = (url: string) => {
    setValue("images", [...imageValues, url], { shouldValidate: true })
  }
  const removeImage = (index: number) => {
    setValue("images", imageValues.filter((_, i) => i !== index), { shouldValidate: true })
  }

  const [imgUploading, setImgUploading] = useState(false)
  const [videoUploading, setVideoUploading] = useState(false)
  const [videoProgress, setVideoProgress] = useState(0)
  const [videoFileName, setVideoFileName] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const { toast } = useToast()
  const { user } = useAuth()
  const limits = useMediaLimits()

  const atImageLimit = imageValues.length >= limits.maxImagesPerListing

  // ── Image upload ────────────────────────────────────────────────────────────
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || !user?.uid) return
    if (atImageLimit) {
      toast({ title: "Photo limit reached", description: `Max ${limits.maxImagesPerListing} photos allowed.`, variant: "destructive" })
      return
    }
    setImgUploading(true)
    try {
      const raw = e.target.files[0]
      // Compress before upload — target 800KB, cap at 1920px wide
      // useWebWorker keeps the UI responsive during compression
      const file = await imageCompression(raw, {
        maxSizeMB:        0.8,
        maxWidthOrHeight: 1920,
        useWebWorker:     true,
        fileType:         "image/webp",   // convert to WebP for best size/quality ratio
      })
      const path = `listings/${user.uid}/${Date.now()}_${raw.name.replace(/\.[^/.]+$/, "")}.webp`
      const result = await StorageService.uploadFile(file, path)
      const url = result.url
      appendImage(url)
      recordMediaUpload({ userId: user.uid, url, path, fileName: raw.name, context: "listing" })
      const savedKB = Math.max(0, Math.round((raw.size - file.size) / 1024))
      toast({
        title: "Photo uploaded",
        description: `${imageValues.length + 1}/${limits.maxImagesPerListing} photos · saved ${savedKB > 0 ? `${savedKB}KB` : "already optimised"}`,
        variant: "success",
      })
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" })
    } finally {
      setImgUploading(false)
      e.target.value = ""
    }
  }

  // ── Video upload ────────────────────────────────────────────────────────────
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user?.uid) return

    // Type check
    if (!limits.allowedVideoTypes.includes(file.type)) {
      toast({
        title: "Unsupported video format",
        description: `Allowed formats: ${limits.allowedVideoTypes.map(t => t.split("/")[1]).join(", ")}`,
        variant: "destructive",
      })
      return
    }

    // Size check
    const sizeMb = file.size / (1024 * 1024)
    if (sizeMb > limits.maxVideoSizeMb) {
      toast({
        title: "Video too large",
        description: `Max size is ${limits.maxVideoSizeMb} MB. Your file is ${sizeMb.toFixed(1)} MB.`,
        variant: "destructive",
      })
      return
    }

    setVideoUploading(true)
    setVideoProgress(0)
    setVideoFileName(file.name)

    try {
      const path = `listings/videos/${user.uid}/${Date.now()}_${file.name}`

      // Use StorageService — never direct firebase/storage imports
      const result = await StorageService.uploadFile(file, path, pct => setVideoProgress(pct))
      const url = result.url
      setValue("verificationVideo", url, { shouldValidate: true })

      toast({ title: "Video uploaded", description: "Verification video attached to listing.", variant: "success" })
    } catch (err: any) {
      toast({ title: "Video upload failed", description: err.message, variant: "destructive" })
      setVideoFileName(null)
    } finally {
      setVideoUploading(false)
      e.target.value = ""
    }
  }

  const removeVideo = () => {
    setValue("verificationVideo", "", { shouldValidate: true })
    setVideoFileName(null)
    setVideoProgress(0)
  }

  const handlePickFromLibrary = (urls: string[]) => {
    const room = Math.max(0, limits.maxImagesPerListing - imageValues.length)
    const toAdd = urls.slice(0, room)
    if (toAdd.length > 0) {
      setValue("images", [...imageValues, ...toAdd], { shouldValidate: true })
    }
    if (urls.length > toAdd.length) {
      toast({
        title: "Some photos skipped",
        description: `Only added ${toAdd.length} — you're at the ${limits.maxImagesPerListing} photo limit.`,
        variant: "destructive",
      })
    }
  }

  // ── Plan label for video requirement ────────────────────────────────────────
  const videoPlanLabel =
    limits.videoRequiredForPlan === "none"    ? null :
    limits.videoRequiredForPlan === "starter" ? "Starter & Pro sellers" :
                                                "Pro sellers"

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">

      {/* ── Photo Upload ───────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>
            Photos — Required
          </Label>
          <span className={cn(
            "text-xs font-medium tabular-nums px-2 py-0.5 rounded-full",
            atImageLimit
              ? "bg-red-100 text-red-700"
              : imageValues.length === 0
              ? "bg-muted text-muted-foreground"
              : "bg-emerald-100 text-emerald-700"
          )}>
            {imageValues.length} / {limits.maxImagesPerListing}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Upload up to {limits.maxImagesPerListing} clear photos. Show all angles — front, back, sides, any damage.
        </p>

        {!atImageLimit && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Choose from my uploads
          </button>
        )}

        <div className="grid grid-cols-3 gap-2">
          {imageValues.map((url, i) => (
            <div key={`${url}-${i}`} className="relative aspect-square rounded-lg overflow-hidden bg-muted border">
              <Image
                src={url}
                alt={`Photo ${i + 1}`}
                fill
                sizes="(max-width: 640px) 33vw, 200px"
                className="object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 hover:bg-red-500 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
              {i === 0 && (
                <span className="absolute bottom-1 left-1 text-[10px] font-bold bg-black/50 text-white px-1.5 py-0.5 rounded">
                  COVER
                </span>
              )}
            </div>
          ))}

          {/* Add photo slot */}
          {!atImageLimit && (
            <label className={cn(
              "aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition",
              imgUploading
                ? "opacity-50 pointer-events-none"
                : "hover:border-primary hover:bg-primary/5 bg-muted/20"
            )}>
              {imgUploading
                ? <Loader2 className="h-6 w-6 text-primary animate-spin" />
                : <Upload className="h-6 w-6 text-muted-foreground mb-1" />
              }
              <span className="text-xs text-muted-foreground mt-1">
                {imgUploading ? "Uploading…" : "Add Photo"}
              </span>
              <Input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
                disabled={imgUploading || atImageLimit}
              />
            </label>
          )}
        </div>

        {atImageLimit && (
          <p className="text-xs text-amber-600 flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Photo limit reached. Remove a photo to add a different one.
          </p>
        )}
      </div>

      {/* ── Verification Video ─────────────────────────────────────────────── */}
      {limits.videoUploadEnabled ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Film className="h-4 w-4 text-primary" />
              <Label>
                Verification Video
                {videoPlanLabel
                  ? <span className="ml-2 text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded uppercase tracking-wide">
                      Required for {videoPlanLabel}
                    </span>
                  : <span className="ml-2 text-xs text-muted-foreground font-normal">(Optional)</span>
                }
              </Label>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Short clip showing the item working — power-on, boot, cold-start, etc.
            Max {limits.maxVideoSizeMb} MB · Max ~{limits.videoMaxDurationSec}s · {limits.allowedVideoTypes.map(t => t.split("/")[1].toUpperCase()).join(", ")}
          </p>

          {/* Uploaded state */}
          {videoUrl && !videoUploading ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-800 truncate">
                  {videoFileName || "Video uploaded"}
                </p>
                <p className="text-xs text-emerald-600">Ready to submit with listing</p>
              </div>
              <button
                type="button"
                onClick={removeVideo}
                className="text-emerald-600 hover:text-red-500 transition-colors shrink-0"
                title="Remove video"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : videoUploading ? (
            /* Upload progress */
            <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-blue-700">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="truncate max-w-[200px]">{videoFileName}</span>
                </div>
                <span className="text-blue-700 font-medium tabular-nums shrink-0">{videoProgress}%</span>
              </div>
              <Progress value={videoProgress} className="h-1.5" />
            </div>
          ) : (
            /* Upload prompt */
            <label className="flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 cursor-pointer transition bg-muted/10">
              <Video className="h-8 w-8 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium text-muted-foreground">Tap to upload verification video</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  MP4, MOV, WebM · Max {limits.maxVideoSizeMb} MB
                </p>
              </div>
              <Input
                type="file"
                accept={limits.allowedVideoTypes.join(",")}
                className="hidden"
                onChange={handleVideoUpload}
                disabled={videoUploading}
              />
            </label>
          )}
        </div>
      ) : (
        /* Video feature disabled by admin */
        <div className="p-4 border-2 border-dashed border-muted rounded-lg bg-muted/10 space-y-2">
          <div className="flex items-center gap-2">
            <Video className="h-5 w-5 text-muted-foreground" />
            <h4 className="font-medium text-muted-foreground text-sm">Verification Video</h4>
            <span className="text-xs font-bold uppercase tracking-wider bg-muted text-muted-foreground px-2 py-0.5 rounded ml-auto">
              Coming Soon
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Video uploads are temporarily disabled. Upload clear photos showing the item from all angles.
          </p>
        </div>
      )}

      <MediaLibraryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        multiple
        context="listing"
        onSelect={() => {}}
        onSelectMultiple={handlePickFromLibrary}
      />
    </div>
  )
}
