-- AlterTable
ALTER TABLE `Document` ADD COLUMN `businessType` VARCHAR(191) NULL,
    ADD COLUMN `quality` VARCHAR(191) NULL,
    ADD COLUMN `tags` JSON NULL,
    MODIFY `status` ENUM('PARSING', 'INDEXING', 'INDEXED', 'FAILED', 'SOFT_DELETED') NOT NULL DEFAULT 'PARSING';

-- AlterTable
ALTER TABLE `DocumentChunk` ADD COLUMN `parentBlockId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `DocumentParentBlock` ADD COLUMN `parentIndex` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `DocumentTaskLog` ADD COLUMN `percent` INTEGER NULL;

-- AlterTable
ALTER TABLE `MemorySummary` ADD COLUMN `lastCompressedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `DocumentIndexConfig` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `chunkSize` INTEGER NOT NULL DEFAULT 800,
    `overlap` INTEGER NOT NULL DEFAULT 120,
    `strategy` VARCHAR(191) NOT NULL DEFAULT 'STRUCTURE',
    `semanticThreshold` DOUBLE NULL DEFAULT 0.6,
    `llmSplitEnabled` BOOLEAN NOT NULL DEFAULT false,
    `parseMode` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'RECOMMEND',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DocumentIndexConfig_documentId_key`(`documentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DocumentIndexConfig` ADD CONSTRAINT `DocumentIndexConfig_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
