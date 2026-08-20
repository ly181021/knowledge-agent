-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'ARCHIVED', 'RESET') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `role` ENUM('user', 'assistant', 'system') NOT NULL,
    `content` TEXT NOT NULL,
    `tokenCount` INTEGER NULL,
    `toolCalls` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Message_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MemorySummary` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MemorySummary_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Document` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `fileUrl` TEXT NOT NULL,
    `fileType` VARCHAR(191) NOT NULL,
    `fileSize` INTEGER NOT NULL,
    `status` ENUM('PARSING', 'INDEXED', 'FAILED', 'SOFT_DELETED') NOT NULL DEFAULT 'PARSING',
    `scopeId` VARCHAR(191) NULL,
    `topicId` VARCHAR(191) NULL,
    `charCount` INTEGER NULL,
    `tokenCount` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Document_status_idx`(`status`),
    INDEX `Document_scopeId_idx`(`scopeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentChunk` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `chunkIndex` INTEGER NOT NULL,
    `content` TEXT NOT NULL,
    `embeddingId` VARCHAR(191) NULL,
    `tokenCount` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DocumentChunk_documentId_chunkIndex_idx`(`documentId`, `chunkIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentParentBlock` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `maxChars` INTEGER NOT NULL DEFAULT 2200,
    `childChunkIds` JSON NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentTaskLog` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `stage` VARCHAR(191) NOT NULL,
    `status` ENUM('RUNNING', 'SUCCESS', 'FAILED') NOT NULL,
    `message` VARCHAR(191) NULL,
    `durationMs` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DocumentTaskLog_documentId_stage_idx`(`documentId`, `stage`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KnowledgeScope` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KnowledgeTopic` (
    `id` VARCHAR(191) NOT NULL,
    `scopeId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KnowledgeRouteTrace` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `question` TEXT NOT NULL,
    `sessionId` VARCHAR(191) NULL,
    `traceId` VARCHAR(191) NULL,
    `rewriteQuestion` TEXT NULL,
    `status` VARCHAR(191) NOT NULL,
    `confidence` DOUBLE NOT NULL,
    `scopeScores` JSON NULL,
    `topicScores` JSON NULL,
    `docScores` JSON NULL,
    `pickedDocId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `KnowledgeRouteTrace_type_createdAt_idx`(`type`, `createdAt`),
    INDEX `KnowledgeRouteTrace_sessionId_idx`(`sessionId`),
    INDEX `KnowledgeRouteTrace_traceId_idx`(`traceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatExchange` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `question` TEXT NOT NULL,
    `answer` TEXT NOT NULL,
    `executionMode` ENUM('CLARIFICATION', 'RETRIEVAL', 'REACT_AGENT', 'GRAPH_ONLY', 'GRAPH_THEN_EVIDENCE') NOT NULL,
    `durationMs` INTEGER NULL,

    INDEX `ChatExchange_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TraceStage` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `exchangeId` VARCHAR(191) NULL,
    `stage` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `input` JSON NULL,
    `output` JSON NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `durationMs` INTEGER NULL,

    INDEX `TraceStage_sessionId_startedAt_idx`(`sessionId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RetrievalResult` (
    `id` VARCHAR(191) NOT NULL,
    `exchangeId` VARCHAR(191) NOT NULL,
    `subQuestionIndex` INTEGER NULL,
    `docId` VARCHAR(191) NULL,
    `chunkId` VARCHAR(191) NULL,
    `chunkContent` TEXT NULL,
    `vectorScore` DOUBLE NULL,
    `keywordScore` DOUBLE NULL,
    `rrfScore` DOUBLE NULL,
    `rerankScore` DOUBLE NULL,
    `accepted` BOOLEAN NOT NULL DEFAULT false,
    `rank` INTEGER NULL,

    INDEX `RetrievalResult_exchangeId_idx`(`exchangeId`),
    INDEX `RetrievalResult_docId_idx`(`docId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChannelExecution` (
    `id` VARCHAR(191) NOT NULL,
    `exchangeId` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `subQuestionIndex` INTEGER NULL,
    `recalled` INTEGER NOT NULL,
    `accepted` INTEGER NOT NULL,
    `durationMs` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_model_usage_trace` (
    `id` VARCHAR(191) NOT NULL,
    `exchangeId` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `promptTokens` INTEGER NOT NULL,
    `completionTokens` INTEGER NOT NULL,
    `totalTokens` INTEGER NOT NULL,
    `durationMs` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatToolTrace` (
    `id` VARCHAR(191) NOT NULL,
    `exchangeId` VARCHAR(191) NOT NULL,
    `toolName` VARCHAR(191) NOT NULL,
    `input` JSON NULL,
    `output` JSON NULL,
    `durationMs` INTEGER NULL,
    `retryCount` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MemorySummary` ADD CONSTRAINT `MemorySummary_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_scopeId_fkey` FOREIGN KEY (`scopeId`) REFERENCES `KnowledgeScope`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_topicId_fkey` FOREIGN KEY (`topicId`) REFERENCES `KnowledgeTopic`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentChunk` ADD CONSTRAINT `DocumentChunk_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentParentBlock` ADD CONSTRAINT `DocumentParentBlock_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentTaskLog` ADD CONSTRAINT `DocumentTaskLog_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KnowledgeTopic` ADD CONSTRAINT `KnowledgeTopic_scopeId_fkey` FOREIGN KEY (`scopeId`) REFERENCES `KnowledgeScope`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatExchange` ADD CONSTRAINT `ChatExchange_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TraceStage` ADD CONSTRAINT `TraceStage_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TraceStage` ADD CONSTRAINT `TraceStage_exchangeId_fkey` FOREIGN KEY (`exchangeId`) REFERENCES `ChatExchange`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RetrievalResult` ADD CONSTRAINT `RetrievalResult_exchangeId_fkey` FOREIGN KEY (`exchangeId`) REFERENCES `ChatExchange`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChannelExecution` ADD CONSTRAINT `ChannelExecution_exchangeId_fkey` FOREIGN KEY (`exchangeId`) REFERENCES `ChatExchange`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_model_usage_trace` ADD CONSTRAINT `chat_model_usage_trace_exchangeId_fkey` FOREIGN KEY (`exchangeId`) REFERENCES `ChatExchange`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatToolTrace` ADD CONSTRAINT `ChatToolTrace_exchangeId_fkey` FOREIGN KEY (`exchangeId`) REFERENCES `ChatExchange`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
