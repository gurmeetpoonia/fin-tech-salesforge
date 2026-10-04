-- AlterTable
ALTER TABLE "sequence_enrollments" ADD COLUMN "orgId" INTEGER;

-- AlterTable
ALTER TABLE "sequences" ADD COLUMN "workflowId" INTEGER;

-- CreateIndex
CREATE INDEX "sequence_enrollments_orgId_idx" ON "sequence_enrollments"("orgId");

-- CreateIndex
CREATE INDEX "sequence_enrollments_leadId_idx" ON "sequence_enrollments"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_enrollments_sequenceId_leadId_key"
ON "sequence_enrollments"("sequenceId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "sequences_workflowId_key"
ON "sequences"("workflowId");

-- AddForeignKey
ALTER TABLE "sequences"
ADD CONSTRAINT "sequences_workflowId_fkey"
FOREIGN KEY ("workflowId") REFERENCES "workflows"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_enrollments"
ADD CONSTRAINT "sequence_enrollments_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "organizations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
