import { Pool } from 'pg';
import { env } from '../config/env';
import { embedQuery, embedChunks } from './embedding.service';
import { chunkText } from './chunker.service';

const pool = new Pool({ connectionString: env.DATABASE_URL });

export const vectorStore = {
  async ingestDocument(name: string, content: string, source: string, type: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'INSERT INTO documents (name,source,type) VALUES ($1,$2,$3) RETURNING id',
        [name, source, type]
      );
      const docId = rows[0].id as string;
      const chunks = chunkText(content);
      const vectors = await embedChunks(chunks.map(c => c.content));
      for (let i = 0; i < chunks.length; i++) {
        await client.query(
          'INSERT INTO document_chunks (document_id,content,embedding,chunk_index) VALUES ($1,$2,$3::vector,$4)',
          [docId, chunks[i].content, '[' + vectors[i].join(',') + ']', i]
        );
      }
      await client.query('COMMIT');
      return { documentId: docId, name, chunksCreated: chunks.length };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async similaritySearch(query: string, topK = 5, threshold = 0.65) {
    const vec = '[' + (await embedQuery(query)).join(',') + ']';
    const { rows } = await pool.query(
      `SELECT dc.content, d.name doc_name, dc.chunk_index,
       1-(dc.embedding<=>$1::vector) similarity
       FROM document_chunks dc JOIN documents d ON d.id=dc.document_id
       WHERE 1-(dc.embedding<=>$1::vector)>$3
       ORDER BY dc.embedding<=>$1::vector LIMIT $2`,
      [vec, topK, threshold]
    );
    return rows as { content: string; doc_name: string; chunk_index: number; similarity: number }[];
  },

  // Hybrid: vector cosine similarity + BM25 keyword via Reciprocal Rank Fusion
  async hybridSearch(query: string, topK = 5) {
    const vec = '[' + (await embedQuery(query)).join(',') + ']';
    const { rows } = await pool.query(
      `WITH v AS (SELECT id, embedding<=>$1::vector d FROM document_chunks ORDER BY d LIMIT 20),
            k AS (SELECT id, ts_rank(to_tsvector('english',content),plainto_tsquery('english',$2)) s
                  FROM document_chunks
                  WHERE to_tsvector('english',content)@@plainto_tsquery('english',$2) LIMIT 20)
       SELECT dc.content, d.name doc_name, dc.chunk_index,
              COALESCE(1.0/(60+v.d),0)+COALESCE(1.0/(60+k.s),0) score
       FROM (SELECT COALESCE(v.id,k.id) id FROM v FULL OUTER JOIN k ON v.id=k.id) ids
       JOIN document_chunks dc ON dc.id=ids.id
       JOIN documents d ON d.id=dc.document_id
       LEFT JOIN v ON v.id=ids.id LEFT JOIN k ON k.id=ids.id
       ORDER BY score DESC LIMIT $3`,
      [vec, query, topK]
    );
    return rows as { content: string; doc_name: string; chunk_index: number; score: number }[];
  },
};
