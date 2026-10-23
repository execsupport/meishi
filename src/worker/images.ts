// Image storage behind a small interface. Today it is Workers KV (R2 is not enabled on the
// account); switching to R2 means adding an R2ImageStore with the same three methods.

export type ImageMeta = { owner: string; contentType: string }
export type StoredImage = { body: ReadableStream; meta: ImageMeta }

export interface ImageStore {
  put(key: string, data: ArrayBuffer, meta: ImageMeta): Promise<void>
  get(key: string): Promise<StoredImage | null>
  delete(key: string): Promise<void>
}

export class KvImageStore implements ImageStore {
  constructor(private kv: KVNamespace) {}

  async put(key: string, data: ArrayBuffer, meta: ImageMeta) {
    await this.kv.put(key, data, { metadata: meta })
  }

  async get(key: string): Promise<StoredImage | null> {
    const { value, metadata } = await this.kv.getWithMetadata<ImageMeta>(key, { type: 'stream' })
    if (!value || !metadata) return null
    return { body: value, meta: metadata }
  }

  async delete(key: string) {
    await this.kv.delete(key)
  }
}
