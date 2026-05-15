import { listTickets, getTicket, updateTicketWithNote } from "../../domain/data/tickets";
import {
  isJiraConfigured,
  jiraIssueToTicket,
  jiraListTickets,
  jiraUpdateTicketWithNote,
} from "../../domain/data/jira-adapter";
import { getIssue } from "../../infrastructure/lib/jira";

export async function listTicketsForApi(userId?: string) {
  if (isJiraConfigured()) {
    const tickets = await jiraListTickets();
    return userId ? tickets.filter((t) => t.user_id === userId) : tickets;
  }
  return listTickets(userId);
}

export async function getTicketForApi(id: string) {
  if (isJiraConfigured()) {
    const issue = await getIssue(id);
    return jiraIssueToTicket(issue);
  }
  return getTicket(id) ?? null;
}

export async function addTicketNoteForApi(id: string, note: string) {
  return isJiraConfigured()
    ? jiraUpdateTicketWithNote(id, note)
    : updateTicketWithNote(id, note);
}
