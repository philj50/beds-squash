import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Content collections.
 *
 * Everything under `src/content/**` is plain Markdown / JSON that committee members
 * can edit through the CMS at /admin (Decap CMS) or directly on GitHub.
 * Uploaded files (PDFs, photos) live in `public/uploads/**` and are referenced by URL.
 */

// Reusable: a URL path to something in /public (e.g. "/uploads/news/photo.jpg")
const uploadPath = z.string().min(1);

const news = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/news' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string().max(280).optional(),
    image: uploadPath.optional(),
    imageAlt: z.string().optional(),
    category: z
      .enum(['county', 'juniors', 'leagues', 'tournaments', 'england-squash', 'clubs', 'racketball'])
      .default('county'),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const events = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/events' }),
  schema: z.object({
    title: z.string(),
    start: z.coerce.date(),
    end: z.coerce.date().optional(),
    allDay: z.boolean().default(true),
    venue: z.string().optional(),
    // Optional link to a club in the clubs collection (by id / filename)
    club: z.string().optional(),
    // Where this date comes from: county committee, a club, or the England Squash calendar
    source: z.enum(['county', 'club', 'england-squash', 'inter-county']).default('county'),
    category: z
      .enum(['tournament', 'league', 'juniors', 'masters', 'meeting', 'coaching', 'social', 'racketball', 'other'])
      .default('other'),
    link: z.url().optional(),
    entryForm: uploadPath.optional(),
    image: uploadPath.optional(),
    cancelled: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const clubs = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/clubs' }),
  schema: z.object({
    name: z.string(),
    venue: z.string(),
    address: z.string(),
    postcode: z.string(),
    // If lat/lng are omitted, the build geocodes the postcode via postcodes.io
    lat: z.number().optional(),
    lng: z.number().optional(),
    courts: z.number().int().nonnegative().optional(),
    town: z.string().optional(),
    website: z.url().optional(),
    bookingUrl: z.url().optional(),
    phone: z.string().optional(),
    email: z.email().optional(),
    facebook: z.url().optional(),
    // e.g. ["Bedford Bulls 1 (Div 1)", "Bedford Bulls 2 (Div 2)"]
    teams: z.array(z.string()).default([]),
    tags: z.array(z.enum(['squash', 'racketball', 'juniors', 'coaching', 'pay-and-play', 'members-club', 'leisure-centre'])).default([]),
    image: uploadPath.optional(),
    // Show in the league clubs list (vs. a venue that just has courts)
    leagueClub: z.boolean().default(true),
    order: z.number().default(100),
  }),
});

const minutes = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/minutes' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    type: z.enum(['agm', 'committee', 'egm', 'other']).default('committee'),
    file: uploadPath.optional(), // PDF in /uploads/minutes
    summary: z.string().optional(),
  }),
});

const documents = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/documents' }),
  schema: z.object({
    title: z.string(),
    category: z.enum(['constitution', 'safeguarding', 'code-of-conduct', 'league-rules', 'forms', 'other']),
    file: uploadPath.optional(),
    updated: z.coerce.date().optional(),
    summary: z.string().optional(),
    order: z.number().default(100),
  }),
});

const galleries = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/galleries' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    cover: uploadPath.optional(),
    credit: z.string().optional(),
    images: z
      .array(
        z.object({
          src: uploadPath,
          alt: z.string().default(''),
          caption: z.string().optional(),
        }),
      )
      .default([]),
  }),
});

const committee = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/committee' }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    email: z.email().optional(),
    photo: uploadPath.optional(),
    order: z.number().default(100),
  }),
});

// Honours board: county closed champions etc., one file per event/year
const honours = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/honours' }),
  schema: z.object({
    event: z.string(), // e.g. "Beds Closed"
    year: z.number().int(),
    results: z
      .array(
        z.object({
          category: z.string(), // "Men's Open", "Ladies", "O45"
          winner: z.string(),
          runnerUp: z.string().optional(),
          score: z.string().optional(),
        }),
      )
      .default([]),
    report: uploadPath.optional(),
    gallery: z.string().optional(), // id of a gallery entry
  }),
});

// Static pages editable via CMS (About, Juniors, Leagues intro, etc.)
const pages = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    intro: z.string().optional(),
    updated: z.coerce.date().optional(),
  }),
});

export const collections = { news, events, clubs, minutes, documents, galleries, committee, honours, pages };
