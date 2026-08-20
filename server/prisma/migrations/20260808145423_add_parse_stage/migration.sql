-- AlterTable
ALTER TABLE `Document` ADD COLUMN `errorCode` VARCHAR(64) NULL,
    ADD COLUMN `errorMsg` TEXT NULL,
    ADD COLUMN `parseStage` VARCHAR(32) NULL;
