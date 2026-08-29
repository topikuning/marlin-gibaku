-- Penjaga tangkap-ganda di `ingest.ts` menanyakan "pesan ini sudah punya
-- lampiran?" setiap kali webhook WAHA mengulang pesan yang sama. Tanpa indeks
-- ini pertanyaan itu memindai seluruh tabel pada tiap pesan bermedia.
CREATE INDEX IF NOT EXISTS "wa_attachments_message_id_idx" ON "wa_attachments"("message_id");
