import { z } from "zod";

export const ingredientSchema = z.object({
  name: z.string().trim().min(1),
  quantity: z.number().positive(),
  unit: z.string().trim().min(1),
});

export const optionSchema = z.object({
  title: z.string().trim().min(1),
  servings: z.number().int().positive(),
  time_minutes: z.number().int().positive(),
  ingredients_used: z.array(ingredientSchema).min(1),
  steps: z.array(z.string().trim().min(1)).min(1),
  notes: z.array(z.string().trim()).default([]),
});

export const plannedMealSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(["breakfast", "lunch", "dinner"]),
  options: z.array(optionSchema).min(1).max(3),
});

export const plannerOutputSchema = z.object({
  meals: z.array(plannedMealSchema).min(1),
});

export type Ingredient = z.infer<typeof ingredientSchema>;
export type MealOption = z.infer<typeof optionSchema>;
export type PlannedMeal = z.infer<typeof plannedMealSchema>;
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
