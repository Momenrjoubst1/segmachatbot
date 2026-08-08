import { knowledgeSupabase as supabase } from "../../config/supabase.config.js";

export { supabase };

/**
 * SQL Schema for the Supabase Database (run this in Supabase SQL Editor):
 * 
 * -- Enable the pgvector extension to work with embedding vectors
 * create extension if not exists vector;
 * 
 * -- Create a table to store your documents
 * create table documents (
 *   id bigserial primary key,
 *   content text, -- corresponds to Document.pageContent
 *   metadata jsonb, -- corresponds to Document.metadata
 *   embedding vector(768) -- 768 is the default for Google's text-embedding-004
 * );
 * 
 * -- Create a function to search for documents
 * create or replace function match_documents (
 *   query_embedding vector(768),
 *   match_threshold float,
 *   match_count int
 * )
 * returns table (
 *   id bigint,
 *   content text,
 *   metadata jsonb,
 *   similarity float
 * )
 * language sql stable
 * as $$
 *   select
 *     documents.id,
 *     documents.content,
 *     documents.metadata,
 *     1 - (documents.embedding <=> query_embedding) as similarity
 *   from documents
 *   where 1 - (documents.embedding <=> query_embedding) > match_threshold
 *   order by similarity desc
 *   limit match_count;
 * $$;
 */
