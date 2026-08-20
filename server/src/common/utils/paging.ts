/**
 * 分页工具 —— 分页 PageRes
 * Prisma where + page/size → { items, total, page, size }
 */
type PrismaModel<TWhere, TInclude> = {
  findMany(args: { where: TWhere; skip: number; take: number; orderBy?: unknown; include?: TInclude }): Promise<unknown[]>
  count(args: { where: TWhere }): Promise<number>
}

export interface PageRes<T> {
  page: number
  size: number
  total: number
  items: T[]
}

export async function paginate<
  TWhere extends object,
  TInclude extends object | undefined,
  TItem = unknown,
>(
  model: PrismaModel<TWhere, TInclude>,
  where: TWhere,
  page = 1,
  size = 20,
  opts?: { orderBy?: unknown; include?: TInclude },
): Promise<PageRes<TItem>> {
  const take = Number(size) || 20
  const skip = (Number(page) - 1) * take
  const [items, total] = await Promise.all([
    model.findMany({ where, skip, take, orderBy: opts?.orderBy, include: opts?.include }) as Promise<TItem[]>,
    model.count({ where }),
  ])
  return { page: Number(page) || 1, size: take, total, items }
}
