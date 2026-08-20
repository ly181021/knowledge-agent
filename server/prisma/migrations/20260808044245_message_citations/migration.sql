-- AlterTable
ALTER TABLE `Message` ADD COLUMN `citations` JSON NULL,
    ADD COLUMN `recommendations` JSON NULL;
