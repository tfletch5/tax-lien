-- Fix missing RLS policies for profiles table
-- Run this in your Supabase SQL Editor

-- Add INSERT policy for profiles (users can insert their own profile)
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Also add UPDATE policy for completeness (already exists but ensuring it's there)
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Make sure users can view their own profile (already exists but ensuring)
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
