import { getCollection } from 'astro:content';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export async function getNews() {
  const posts = await getCollection('news', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getEvents() {
  const events = await getCollection('events', ({ data }) => !data.draft);
  return events.sort((a, b) => a.data.start.getTime() - b.data.start.getTime());
}

/** Events that haven't finished yet (end date, or start date if no end). */
export async function getUpcomingEvents() {
  const today = startOfToday();
  return (await getEvents()).filter((e) => (e.data.end ?? e.data.start).getTime() >= today.getTime());
}

export async function getPastEvents() {
  const today = startOfToday();
  return (await getEvents())
    .filter((e) => (e.data.end ?? e.data.start).getTime() < today.getTime())
    .reverse();
}

export async function getClubs() {
  const clubs = await getCollection('clubs');
  return clubs.sort((a, b) => a.data.order - b.data.order || a.data.name.localeCompare(b.data.name));
}

export async function getMinutes() {
  return (await getCollection('minutes')).sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getDocuments() {
  return (await getCollection('documents')).sort((a, b) => a.data.order - b.data.order);
}

export async function getGalleries() {
  return (await getCollection('galleries')).sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getCommittee() {
  return (await getCollection('committee')).sort((a, b) => a.data.order - b.data.order);
}

export async function getHonours() {
  return (await getCollection('honours')).sort((a, b) => b.data.year - a.data.year || a.data.event.localeCompare(b.data.event));
}
