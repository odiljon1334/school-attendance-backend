-- CreateEnum
CREATE TYPE "CameraEventType" AS ENUM ('CLASSROOM_PRESENCE', 'CLASSROOM_LEAVE', 'UNKNOWN_PERSON');

-- CreateEnum  
CREATE TYPE "EmotionType" AS ENUM ('HAPPY', 'NEUTRAL', 'SAD', 'ANGRY', 'SURPRISED', 'FEARFUL', 'DISGUSTED');

-- CreateTable FaceEmbedding
CREATE TABLE "FaceEmbedding" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT,
    "teacherId" TEXT,
    "embedding" DOUBLE PRECISION[],
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FaceEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable ClassroomPresence
CREATE TABLE "ClassroomPresence" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "studentId" TEXT,
    "teacherId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL,
    "emotion" "EmotionType",
    "attention" DOUBLE PRECISION,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClassroomPresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable CameraEvent
CREATE TABLE "CameraEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "type" "CameraEventType" NOT NULL,
    "snapshot" TEXT,
    "confidence" DOUBLE PRECISION,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "studentId" TEXT,
    "teacherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CameraEvent_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
ALTER TABLE "FaceEmbedding" ADD CONSTRAINT "FaceEmbedding_studentId_key" UNIQUE ("studentId");
ALTER TABLE "FaceEmbedding" ADD CONSTRAINT "FaceEmbedding_teacherId_key" UNIQUE ("teacherId");

-- Indexes
CREATE INDEX "FaceEmbedding_schoolId_idx" ON "FaceEmbedding"("schoolId");
CREATE INDEX "ClassroomPresence_schoolId_date_idx" ON "ClassroomPresence"("schoolId", "date");
CREATE INDEX "ClassroomPresence_cameraId_date_idx" ON "ClassroomPresence"("cameraId", "date");
CREATE INDEX "ClassroomPresence_studentId_date_idx" ON "ClassroomPresence"("studentId", "date");
CREATE INDEX "ClassroomPresence_teacherId_date_idx" ON "ClassroomPresence"("teacherId", "date");
CREATE INDEX "CameraEvent_schoolId_detectedAt_idx" ON "CameraEvent"("schoolId", "detectedAt");
CREATE INDEX "CameraEvent_cameraId_detectedAt_idx" ON "CameraEvent"("cameraId", "detectedAt");
CREATE INDEX "CameraEvent_type_idx" ON "CameraEvent"("type");
CREATE INDEX "CameraEvent_createdAt_idx" ON "CameraEvent"("createdAt");

-- Foreign Keys
ALTER TABLE "FaceEmbedding" ADD CONSTRAINT "FaceEmbedding_schoolId_fkey" 
    FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FaceEmbedding" ADD CONSTRAINT "FaceEmbedding_studentId_fkey" 
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FaceEmbedding" ADD CONSTRAINT "FaceEmbedding_teacherId_fkey" 
    FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClassroomPresence" ADD CONSTRAINT "ClassroomPresence_schoolId_fkey" 
    FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassroomPresence" ADD CONSTRAINT "ClassroomPresence_cameraId_fkey" 
    FOREIGN KEY ("cameraId") REFERENCES "SchoolCamera"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassroomPresence" ADD CONSTRAINT "ClassroomPresence_studentId_fkey" 
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClassroomPresence" ADD CONSTRAINT "ClassroomPresence_teacherId_fkey" 
    FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CameraEvent" ADD CONSTRAINT "CameraEvent_schoolId_fkey" 
    FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CameraEvent" ADD CONSTRAINT "CameraEvent_cameraId_fkey" 
    FOREIGN KEY ("cameraId") REFERENCES "SchoolCamera"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CameraEvent" ADD CONSTRAINT "CameraEvent_studentId_fkey" 
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CameraEvent" ADD CONSTRAINT "CameraEvent_teacherId_fkey" 
    FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;