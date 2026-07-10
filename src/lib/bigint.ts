/**
 * BigInt serializer.
 *
 * Rupiah disimpan sebagai BigInt (lihat CLAUDE.md § Money). `JSON.stringify`
 * tidak mendukung BigInt native — helper ini mengubahnya jadi string sebelum
 * serialisasi ke API boundary.
 *
 * Pakai di setiap response API / Server Action yang mengembalikan nilai uang.
 */
export function serializeBigInt<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  ) as T;
}
