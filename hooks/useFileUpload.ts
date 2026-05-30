'use client'

import { useState, useCallback } from 'react'

export type UploadedFile = {
  id: string
  file_name: string
  file_path: string
  file_size: number
  file_type: string | null
  mime_type: string | null
  is_final: boolean
  bucket: string
  direction: string
  uploaded_by_role: string | null
  description: string | null
  created_at: string
}

export type UploadProgress = {
  id: string
  fileName: string
  progress: number
  status: 'uploading' | 'success' | 'error'
  error?: string
}

export function useFileUpload(
  projectId: string,
  _clientId: string,
  userId: string,
  userRole: 'admin' | 'client',
  userName: string
) {
  const [uploads, setUploads] = useState<
    UploadProgress[]
  >([])

  function updateUpload(
    id: string,
    update: Partial<UploadProgress>
  ) {
    setUploads((prev) =>
      prev.map((u) =>
        u.id === id ? { ...u, ...update } : u
      )
    )
  }

  const uploadFiles = useCallback(
    async (
      fileList: FileList | File[],
      options?: {
        isFinal?: boolean
        notes?: string
        category?: string
      }
    ): Promise<UploadedFile[]> => {
      const files = Array.from(fileList)
      const results: UploadedFile[] = []

      for (const file of files) {
        const uploadId = `upload-${Date.now()}-${
          Math.random()
        }`

        setUploads((prev) => [
          ...prev,
          {
            id: uploadId,
            fileName: file.name,
            progress: 0,
            status: 'uploading',
          },
        ])

        try {
          const formData = new FormData()
          formData.append('file', file)
          formData.append('projectId', projectId)
          formData.append(
            'category',
            options?.category ??
              (options?.isFinal ? 'deliverable' : 'general')
          )
          if (options?.isFinal) {
            formData.append('isFinal', 'true')
          }
          if (options?.notes) {
            formData.append(
              'description',
              options.notes
            )
          }

          // Use XHR for real progress tracking
          const fileRecord = await new Promise<UploadedFile>(
            (resolve, reject) => {
              const xhr = new XMLHttpRequest()

              xhr.upload.addEventListener(
                'progress',
                (e) => {
                  if (e.lengthComputable) {
                    updateUpload(uploadId, {
                      progress: Math.round(
                        (e.loaded / e.total) * 100
                      ),
                    })
                  }
                }
              )

              xhr.addEventListener('load', () => {
                if (
                  xhr.status >= 200 &&
                  xhr.status < 300
                ) {
                  try {
                    const r = JSON.parse(
                      xhr.responseText
                    )
                    resolve(r.file)
                  } catch {
                    reject(
                      new Error('Invalid response')
                    )
                  }
                } else {
                  try {
                    const r = JSON.parse(
                      xhr.responseText
                    )
                    reject(
                      new Error(
                        r.error ?? 'Upload failed'
                      )
                    )
                  } catch {
                    reject(
                      new Error('Upload failed')
                    )
                  }
                }
              })

              xhr.addEventListener('error', () =>
                reject(new Error('Network error'))
              )

              xhr.open('POST', '/api/files/upload')
              xhr.send(formData)
            }
          )

          updateUpload(uploadId, {
            progress: 100,
            status: 'success',
          })

          results.push(fileRecord)

          // Activity is logged server-side by /api/files/upload — no client call needed.

          // Clear from progress list after 3s
          setTimeout(() => {
            setUploads((prev) =>
              prev.filter((u) => u.id !== uploadId)
            )
          }, 3000)
        } catch (err: any) {
          updateUpload(uploadId, {
            status: 'error',
            error: err.message ?? 'Upload failed',
          })

          // Clear error after 5s
          setTimeout(() => {
            setUploads((prev) =>
              prev.filter((u) => u.id !== uploadId)
            )
          }, 5000)
        }
      }

      return results
    },
    [projectId, userId, userRole, userName]
  )

  return { uploadFiles, uploads }
}
