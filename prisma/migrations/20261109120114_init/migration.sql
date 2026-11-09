-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EXECUTIVE', 'SALES_HEAD');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'HI', 'GU');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('PORTAL', 'SOCIAL_AD', 'WEBSITE', 'HOARDING');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'ENGAGED', 'VISIT_BOOKED', 'VISITED', 'HANDED_OFF', 'CLOSED');

-- CreateEnum
CREATE TYPE "DupStatus" AS ENUM ('NONE', 'POSSIBLE', 'LINKED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('HELD', 'BOOKED', 'VISITED', 'NO_SHOW', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BookedVia" AS ENUM ('AI_CHAT', 'SLOT_PICKER', 'STAFF');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'HANDED_OFF');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('BUYER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('SMS', 'EMAIL', 'INTERNAL');

-- CreateEnum
CREATE TYPE "OutboxKind" AS ENUM ('FIRST_TOUCH', 'CONFIRMATION', 'REMINDER_24H', 'REMINDER_2H', 'CANCELLATION', 'HANDOFF_ALERT');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('SCHEDULED', 'SENT', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FlagReason" AS ENUM ('OUTPUT_BLOCKED', 'MISSING_FACT', 'DISCOUNT_REQUEST', 'INJECTION', 'DISTRESS', 'AI_ERROR');

-- CreateEnum
CREATE TYPE "FlagVerdict" AS ENUM ('PENDING', 'FINE', 'FIX_FACT_SHEET', 'FIX_BEHAVIOUR');

-- CreateEnum
CREATE TYPE "FactTag" AS ENUM ('RERA_REGISTERED', 'MARKETING');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "languages" "Language"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locality" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "mapUrl" TEXT NOT NULL,
    "reraNumber" TEXT NOT NULL,
    "bhkOptions" TEXT[],

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutiveProject" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "ExecutiveProject_pkey" PRIMARY KEY ("userId","projectId")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "phoneKey" TEXT,
    "email" TEXT,
    "language" "Language" NOT NULL DEFAULT 'EN',
    "source" "LeadSource" NOT NULL,
    "projectId" TEXT,
    "bhk" TEXT,
    "budget" TEXT,
    "timeline" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "closedReason" TEXT,
    "ownerId" TEXT,
    "consentAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "reachedAt" TIMESTAMP(3),
    "summary" TEXT,
    "duplicateOfId" TEXT,
    "dupStatus" "DupStatus" NOT NULL DEFAULT 'NONE',
    "dupReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadTouch" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL,
    "campaign" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadTouch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "leadId" TEXT,
    "projectId" TEXT,
    "language" "Language" NOT NULL DEFAULT 'EN',
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "consentAt" TIMESTAMP(3),
    "offeredSlotIds" TEXT[],
    "aiFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "card" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotTemplate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "SlotTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "capacity" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "VisitStatus" NOT NULL,
    "holdExpiresAt" TIMESTAMP(3),
    "executiveId" TEXT,
    "manageToken" TEXT NOT NULL,
    "bookedVia" "BookedVia" NOT NULL,
    "outcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "visitId" TEXT,
    "channel" "Channel" NOT NULL,
    "kind" "OutboxKind" NOT NULL,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'SCHEDULED',
    "note" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Handoff" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "conversationId" TEXT,
    "executiveId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Handoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flag" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "leadId" TEXT,
    "reason" "FlagReason" NOT NULL,
    "detail" TEXT NOT NULL,
    "excerpt" TEXT,
    "verdict" "FlagVerdict" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "valueEn" TEXT NOT NULL,
    "valueHi" TEXT,
    "valueGu" TEXT,
    "tag" "FactTag" NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactRevision" (
    "id" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "valueEn" TEXT NOT NULL,
    "valueHi" TEXT,
    "valueGu" TEXT,
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpendEntry" (
    "id" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL,
    "month" TEXT NOT NULL,
    "amountInr" INTEGER NOT NULL,

    CONSTRAINT "SpendEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Lead_phoneKey_idx" ON "Lead"("phoneKey");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_ownerId_status_idx" ON "Lead"("ownerId", "status");

-- CreateIndex
CREATE INDEX "LeadTouch_leadId_idx" ON "LeadTouch"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_token_key" ON "Conversation"("token");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SlotTemplate_projectId_weekday_startMinute_key" ON "SlotTemplate"("projectId", "weekday", "startMinute");

-- CreateIndex
CREATE INDEX "Slot_projectId_startsAt_idx" ON "Slot"("projectId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Slot_projectId_startsAt_key" ON "Slot"("projectId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_manageToken_key" ON "Visit"("manageToken");

-- CreateIndex
CREATE INDEX "Visit_leadId_status_idx" ON "Visit"("leadId", "status");

-- CreateIndex
CREATE INDEX "Visit_status_holdExpiresAt_idx" ON "Visit"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "Outbox_status_sendAt_idx" ON "Outbox"("status", "sendAt");

-- CreateIndex
CREATE INDEX "Outbox_leadId_idx" ON "Outbox"("leadId");

-- CreateIndex
CREATE INDEX "Handoff_executiveId_acknowledgedAt_idx" ON "Handoff"("executiveId", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "Flag_verdict_createdAt_idx" ON "Flag"("verdict", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Fact_projectId_key_key" ON "Fact"("projectId", "key");

-- CreateIndex
CREATE INDEX "FactRevision_factId_idx" ON "FactRevision"("factId");

-- CreateIndex
CREATE UNIQUE INDEX "SpendEntry_source_month_key" ON "SpendEntry"("source", "month");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "ExecutiveProject" ADD CONSTRAINT "ExecutiveProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutiveProject" ADD CONSTRAINT "ExecutiveProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTouch" ADD CONSTRAINT "LeadTouch_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotTemplate" ADD CONSTRAINT "SlotTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_executiveId_fkey" FOREIGN KEY ("executiveId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outbox" ADD CONSTRAINT "Outbox_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outbox" ADD CONSTRAINT "Outbox_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_executiveId_fkey" FOREIGN KEY ("executiveId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactRevision" ADD CONSTRAINT "FactRevision_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hard guards the app logic relies on (not expressible in Prisma schema)
-- 1. a slot can never hold more visits than its capacity
ALTER TABLE "Slot" ADD CONSTRAINT "slot_reserved_within_capacity" CHECK ("reserved" >= 0 AND "reserved" <= "capacity");
-- 2. a lead has at most one live (held or booked) visit at a time
CREATE UNIQUE INDEX "visit_one_active_per_lead" ON "Visit" ("leadId") WHERE "status" IN ('HELD', 'BOOKED');
