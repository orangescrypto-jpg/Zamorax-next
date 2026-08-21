// lib/mediaLibrary.ts
// Records a successful upload into media_library so it shows up later in
// MediaLibraryPicker ("My uploads") instead of forcing a re-upload for the
// next listing or blog post. Never call directly from components — route
// through this helper, same rule as every other D1 write (see AdminService).

import { AdminService } from "@/src/services"

export async function recordMediaUpload(params: {
  userId: string
  url: string
  path?: string
  fileName?: string
  context?: "listing" | "blog_cover" | string
}): Promise<void> {
  try {
    const id = AdminService.generateId()
    await AdminService.setDoc("media_library", id, {
      userId:   params.userId,
      url:      params.url,
      path:     params.path ?? null,
      fileName: params.fileName ?? null,
      context:  params.context ?? null,
    })
  } catch (err) {
    // Non-fatal — the upload itself already succeeded and the image is
    // already attached to the listing/post. Losing the "reuse later" entry
    // shouldn't block or error out the user's actual save.
    console.error("[recordMediaUpload] failed to save to media_library:", err)
  }
}
