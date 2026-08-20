-- AlterTable: DocumentIndexConfig — strategy 单值 → pipeline 有序策略流水线
-- 对应 schema.prisma：pipeline Json?（Prisma Json 不支持 @default，默认值由应用层 ChunkConfigAdvisor 提供）
ALTER TABLE `DocumentIndexConfig` DROP COLUMN `strategy`, DROP COLUMN `llmSplitEnabled`, ADD COLUMN `pipeline` JSON NULL;
