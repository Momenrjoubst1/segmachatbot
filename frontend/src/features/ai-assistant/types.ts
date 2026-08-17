/**
 * Assistant Types
 * أنواع المساعد
 * 
 * Shared type definitions for the AI assistant feature
 */

export type ActiveView = 'chat' | 'calendar';

export interface AcademicCourse {
  id: string;
  course_name: string;
  credit_hours: number;
  // Add other course properties as needed
}