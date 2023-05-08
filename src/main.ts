const calendarId = 'primary'

type Event = GoogleAppsScript.Calendar.Schema.Event
type EventAttendee = GoogleAppsScript.Calendar.Schema.EventAttendee

export function getTargetEmails() {
  const properties = PropertiesService.getScriptProperties()
  const emails = properties.getProperty('TARGET_EMAILS')

  if (emails === null) {
    throw new Error('targetEmails is not found')
  }

  return emails.replace(/\s/g, '').split(',')
}

export function getNextSyncToken(nextPageToken?: string): string {
  const options = nextPageToken ? { pageToken: nextPageToken } : {}
  const events = Calendar.Events.list(calendarId, options)

  if (events.nextSyncToken) {
    return events.nextSyncToken
  } else if (events.nextPageToken) {
    return getNextSyncToken(events.nextPageToken)
  } else {
    throw new Error('nextSyncToken or nextPageToken not found')
  }
}

export function shouldUpdateEvent(event: Event): boolean {
  if (event.status === 'cancelled') {
    console.log('This event is cancelled', event.id)
    return false
  }

  if (event.organizer.self !== true && event.guestsCanInviteOthers === false) {
    console.log('This event is not allowed to invite others: ', event.id)
    return false
  }

  // If you are the organizer yourself
  if (event.attendees === undefined) {
    console.log('This event does not have attendees: ', event.id)
    return true
  }

  const targetEmails = getTargetEmails()
  const { attendees } = event
  const { responseStatus, optional } = selfAttendeeStatus(event)
  const targetAttendees = attendees.filter((a) =>
    targetEmails.some((email) => a.email === email)
  )
  const shouldUpdateTargetAtendees = targetAttendees.some(
    (a) =>
      a.responseStatus !== responseStatus || (a.optional === true) !== optional
  )

  if (shouldUpdateTargetAtendees) {
    console.log('This event status needs to be updated: ', event.id)
    return true
  }

  const newEmails = targetEmails.filter(
    (email) => !attendees.some((a) => a.email === email)
  )

  return newEmails.length > 0
}

export function selfAttendeeStatus(event): EventAttendee {
  // No attendees = you are the organizer
  if (event.attendees === undefined) {
    return {
      responseStatus: 'accepted',
      optional: false,
    }
  }

  const { attendees } = event
  const selfAttendee = attendees.find((a) => a.self === true)

  return {
    responseStatus: selfAttendee.responseStatus,
    optional: selfAttendee.optional === true,
  }
}

export function main() {
  const properties = PropertiesService.getUserProperties()
  const nextSyncToken = properties.getProperty('nextSyncToken')

  // 初回は同期しない
  if (!nextSyncToken) {
    console.log('nextSyncToken is not found')
    properties.setProperty('nextSyncToken', getNextSyncToken())
    console.log('nextSyncToken is set')
    return
  }

  const events = Calendar.Events.list(calendarId, { syncToken: nextSyncToken })
  const targetEmails = getTargetEmails()

  events.items.forEach((event) => {
    console.log('event: ', event)

    if (!shouldUpdateEvent(event)) {
      console.log('This event does not need to be updated: ', event.id)
      return
    }

    const prevAttendees: EventAttendee[] = event.attendees || []

    const prevTargetAttendees: EventAttendee[] = prevAttendees.filter((a) =>
      targetEmails.some((email) => a.email === email)
    )

    const nextTargetAttendees: EventAttendee[] = targetEmails.map((email) => {
      const prevTargetAttendee = prevTargetAttendees.find(
        (a) => a.email === email
      )
      return { email, ...prevTargetAttendee, ...selfAttendeeStatus(event) }
    })

    const nextAttendees: EventAttendee[] = [
      ...prevAttendees.filter(
        (a) => !targetEmails.some((email) => a.email === email)
      ),
      ...nextTargetAttendees,
    ]

    event.attendees = nextAttendees

    try {
      const updatedEvent = Calendar.Events.update(
        event,
        calendarId,
        event.id,
        {
          sendUpdates: 'none',
        },
        { 'If-Match': event.etag }
      )
      const start = new Date(
        updatedEvent.start.dateTime || updatedEvent.start.date
      )
      console.log(
        `update the ${start.toLocaleString()} event "${
          updatedEvent.summary
        }" from ${JSON.stringify(prevTargetAttendees)} to ${JSON.stringify(
          nextTargetAttendees
        )}`,
        event.id
      )
    } catch (e) {
      console.error(e)
    }
  })

  const newSyncToken = getNextSyncToken()
  properties.setProperty('nextSyncToken', newSyncToken)
}
