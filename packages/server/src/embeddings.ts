let pipeline: unknown = null;

export const EMBEDDING_DIMENSIONS = 384;

/**
 * Generate a vector embedding for the given text using a local transformer model.
 * Lazy-loads the model on first call (~23MB download, cached in ~/.cache/huggingface/).
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  if (!pipeline) {
    const { pipeline: pipelineFn } = await import('@huggingface/transformers');
    pipeline = await pipelineFn('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('[embeddings] Model loaded: Xenova/all-MiniLM-L6-v2');
  }

  const pipelineFn = pipeline as (
    text: string,
    opts: { pooling: string; normalize: boolean },
  ) => Promise<{ data: Float32Array }>;

  const output = await pipelineFn(text, { pooling: 'mean', normalize: true });
  return output.data;
}

/** Convert a Float32Array to a Buffer for SQLite BLOB storage. */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

/** Convert a SQLite BLOB Buffer back to a Float32Array. */
export function bufferToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
