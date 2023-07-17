import { expect, vi, test, describe, beforeEach } from 'vitest'
import { shouldUpdateEvent, getTargetEmails, main } from './main'

type Event = GoogleAppsScript.Calendar.Schema.Event

test('getTargetEmails', () => {
  const email = 'test@example.local'

  vi.stubGlobal('PropertiesService', {
    getScriptProperties: vi.fn(() => ({
      getProperty: vi.fn((key: string) => email),
    })),
  })

  expect(getTargetEmails()).toEqual([email])
})

describe('shouldUpdateEvent', () => {
  const targetEmail = 'target@example.local'

  beforeEach(() => {
    vi.resetAllMocks()

    vi.stubGlobal('PropertiesService', {
      getScriptProperties: vi.fn(() => ({
        getProperty: vi.fn((key: string) => targetEmail),
      })),
    })
  })

  describe('自身がオーガナイザー', () => {
    const selfAttendee = { email: 'self@example.dev', self: true }
    const eventDefault: Event = {
      organizer: selfAttendee,
    }

    test('attendees がない', () => {
      expect(shouldUpdateEvent(eventDefault)).toBe(true)
    })

    test('attendees がある', () => {
      expect(
        shouldUpdateEvent({
          ...eventDefault,
          attendees: [selfAttendee, { email: 'someone@example.com' }],
        })
      ).toBe(true)
    })

    test('ゲストは招待できない', () => {
      expect(
        shouldUpdateEvent({
          ...eventDefault,
          guestsCanInviteOthers: false,
          attendees: [selfAttendee, { email: 'someone@example.com' }],
        })
      ).toBe(true)
    })

    test('attendees が自身だけ', () => {
      expect(
        shouldUpdateEvent({
          ...eventDefault,
          attendees: [selfAttendee],
        })
      ).toBe(true)
    })

    test('attendees がターゲット、状態が違う', () => {
      expect(
        shouldUpdateEvent({
          ...eventDefault,
          attendees: [
            { self: true, email: 'self@example.com', optional: true },
            { email: targetEmail },
          ],
        })
      ).toBe(false)

      expect(
        shouldUpdateEvent({
          ...eventDefault,
          attendees: [
            {
              self: true,
              email: 'self@example.com',
              responseStatus: 'accepted',
            },
            { email: targetEmail, responseStatus: 'needsResponse' },
          ],
        })
      ).toBe(false)
    })
  })

  describe('オーガナイザーが他人', () => {
    test('attendees に自身が含まれる', () => {
      expect(
        shouldUpdateEvent({
          organizer: { email: 'someone@example.com' },
          attendees: [{ self: true, email: 'self@example.com' }],
        })
      ).toBe(true)
    })

    test('更新の必要がない', () => {
      expect(
        shouldUpdateEvent({
          organizer: { email: 'someone@example.com' },
          attendees: [
            { email: 'someone@example.com' },
            {
              self: true,
              email: 'self@example.com',
              responseStatus: 'needsAction',
            },
            {
              email: targetEmail,
              responseStatus: 'needsAction',
            },
          ],
        })
      ).toBe(false)

      expect(
        shouldUpdateEvent({
          organizer: { email: 'someone@example.com' },
          attendees: [
            { email: 'someone@example.com' },
            {
              self: true,
              email: 'self@example.com',
              responseStatus: 'needsAction',
              optional: true,
            },
            {
              email: targetEmail,
              responseStatus: 'needsAction',
            },
          ],
        })
      ).toBe(false)

      expect(
        shouldUpdateEvent({
          organizer: { email: 'someone@example.com' },
          attendees: [
            { email: 'someone@example.com' },
            {
              self: true,
              email: 'self@example.com',
              responseStatus: 'accepted',
            },
            {
              email: targetEmail,
              responseStatus: 'needsAction',
            },
          ],
        })
      ).toBe(false)
    })
  })
})

describe('main', () => {
  const id = 'eventId'
  const calendarId = 'primary'
  const etag = 'xxx-etag'

  function mockCalendar({
    list = vi.fn((calendarId: string, options: any) => ({
      items: [],
      nextSyncToken: 'gotNextSyncToken',
    })),
    update = vi.fn(
      (event: any, calendarId: string, eventId: string, options: any) => ({
        start: { dateTime: '2020-01-01T00:00:00+09:00' },
        summary: 'updated event',
      })
    ),
  }: {
    list?: any
    update?: any
  }) {
    vi.stubGlobal('Calendar', {
      Events: {
        list,
        update,
      },
    })
  }

  function mockPropertiesService({
    email,
    getUserProperty = vi.fn((_: string) => 'defaultNextToken'),
    setUserProperty = vi.fn((_: string, __: string) => null),
  }: {
    email?: string
    getUserProperty?: any
    setUserProperty?: any
  }) {
    vi.stubGlobal('PropertiesService', {
      getScriptProperties: vi.fn(() => ({
        getProperty: vi.fn((key: string) => email),
      })),
      getUserProperties: vi.fn(() => ({
        getProperty: getUserProperty,
        setProperty: setUserProperty,
      })),
    })
  }

  beforeEach(() => {
    vi.resetAllMocks()
  })

  test('自分が含まれていない場合は何もしない', () => {
    const list = vi.fn((calendarId: string, options: any) => ({
      items: [],
      nextSyncToken: 'gotNextSyncToken',
    }))
    const update = vi.fn((args: any) => ({}))
    const email = 'test@example.local'
    const getUserProperty = vi.fn((_: string) => 'defaultNextToken')
    const setUserProperty = vi.fn((_: string, __: string) => null)

    mockPropertiesService({ email, getUserProperty, setUserProperty })
    mockCalendar({ update, list })

    expect(main()).toBe(undefined)
    expect(getUserProperty).toBeCalledWith('nextSyncToken')
    expect(setUserProperty).toBeCalledWith('nextSyncToken', 'gotNextSyncToken')
    expect(list).toBeCalled()
    expect(update).not.toBeCalled()
  })

  test('同期される', () => {
    const event: Event = {
      id,
      etag,
      organizer: { self: true },
      attendees: [
        {
          email: 'a@b.c',
          self: true,
          responseStatus: 'accepted',
        },
      ],
    }

    const list = vi.fn((calendarId: string, options: any) => ({
      items: [event],
      nextSyncToken: 'gotNextSyncToken',
    }))

    const update = vi.fn(
      (event: any, calendarId: string, eventId: string, options: any) => {
        return {
          start: { dateTime: '2020-01-01T00:00:00+09:00' },
          summary: 'updated event',
        }
      }
    )
    const email = 'test@example.local'

    mockPropertiesService({ email })
    mockCalendar({
      update,
      list,
    })

    const nextEvent = {
      ...event,
      attendees: [
        {
          email: 'a@b.c',
          self: true,
          responseStatus: 'accepted',
        },
        {
          email,
          responseStatus: 'accepted',
          optional: false,
        },
      ],
    }

    expect(main()).toBe(undefined)
    expect(update).toBeCalled()
    expect(update).toBeCalledWith(
      nextEvent,
      calendarId,
      id,
      {
        sendUpdates: 'none',
      },
      { 'If-Match': etag }
    )
  })

  test('初回は同期しない', () => {
    const event: Event = {
      id,
      etag,
      organizer: { self: true },
      attendees: [
        {
          email: 'a@b.c',
          self: true,
          responseStatus: 'accepted',
        },
      ],
    }

    const list = vi.fn((calendarId: string, options: any) => ({
      items: [event],
      nextSyncToken: 'gotNextSyncToken',
    }))

    const update = vi.fn(
      (event: any, calendarId: string, eventId: string, options: any) => {
        return {
          start: { dateTime: '2020-01-01T00:00:00+09:00' },
          summary: 'updated event',
        }
      }
    )
    const email = 'test@example.local'

    const getUserProperty = vi.fn((_: string) => null)

    mockPropertiesService({ email, getUserProperty })
    mockCalendar({
      update,
      list,
    })

    expect(main()).toBe(undefined)
    expect(update).not.toBeCalled()
  })

  test('複数のカレンダーに追加', () => {
    const event: Event = {
      id,
      etag,
      organizer: { self: true },
      attendees: [
        {
          email: 'a@b.c',
          self: true,
          responseStatus: 'needsAction',
        },
      ],
    }

    const list = vi.fn((calendarId: string, options: any) => ({
      items: [event],
      nextSyncToken: 'gotNextSyncToken',
    }))

    const update = vi.fn(
      (event: any, calendarId: string, eventId: string, options: any) => {
        return {
          start: { dateTime: '2020-01-01T00:00:00+09:00' },
          summary: 'updated event',
        }
      }
    )
    const emails = ['test@example.local', 'test@example.dev']

    mockPropertiesService({ email: emails.join(',') })
    mockCalendar({
      update,
      list,
    })

    const nextEvent = {
      ...event,
      attendees: [
        {
          email: 'a@b.c',
          self: true,
          responseStatus: 'needsAction',
        },
        {
          email: 'test@example.local',
          responseStatus: 'needsAction',
          optional: false,
        },
        {
          email: 'test@example.dev',
          responseStatus: 'needsAction',
          optional: false,
        },
      ],
    }

    expect(main()).toBe(undefined)
    expect(update).toBeCalled()
    expect(update).toBeCalledWith(
      nextEvent,
      calendarId,
      id,
      {
        sendUpdates: 'none',
      },
      { 'If-Match': etag }
    )
  })

  test('ターゲット以外のメールアドレスはそのまま', () => {
    const event: Event = {
      id,
      etag,
      organizer: { self: true },
      attendees: [
        {
          email: 'user@example.com',
          self: true,
          responseStatus: 'needsAction',
        },
        {
          email: 'other@example.com',
          responseStatus: 'accepted',
        },
        {
          email: 'other2@example.dev',
          responseStatus: 'needsAction',
          optional: true,
        },
      ],
    }

    const list = vi.fn((calendarId: string, options: any) => ({
      items: [event],
      nextSyncToken: 'gotNextSyncToken',
    }))

    const update = vi.fn(
      (event: any, calendarId: string, eventId: string, options: any) => {
        return {
          start: { dateTime: '2020-01-01T00:00:00+09:00' },
          summary: 'updated event',
        }
      }
    )
    const emails = ['test@example.local', 'test@example.dev']

    mockPropertiesService({ email: emails.join(',') })
    mockCalendar({
      update,
      list,
    })

    const nextEvent = {
      ...event,
      attendees: [
        {
          email: 'user@example.com',
          self: true,
          responseStatus: 'needsAction',
        },
        {
          email: 'other@example.com',
          responseStatus: 'accepted',
        },
        {
          email: 'other2@example.dev',
          responseStatus: 'needsAction',
          optional: true,
        },
        {
          email: 'test@example.local',
          responseStatus: 'needsAction',
          optional: false,
        },
        {
          email: 'test@example.dev',
          responseStatus: 'needsAction',
          optional: false,
        },
      ],
    }

    expect(main()).toBe(undefined)
    expect(update).toBeCalled()
    expect(update).toBeCalledWith(
      nextEvent,
      calendarId,
      id,
      {
        sendUpdates: 'none',
      },
      { 'If-Match': etag }
    )
  })

  test('ターゲットが招待済みでも自身の状態に合わせる（update: 状態の同期は廃止）', () => {
    const event: Event = {
      id,
      etag,
      organizer: { self: true },
      attendees: [
        {
          email: 'user@example.com',
          self: true,
          responseStatus: 'accepted',
        },
        {
          email: 'other@example.com',
          responseStatus: 'accepted',
        },
        {
          email: 'other2@example.dev',
          responseStatus: 'needsAction',
          optional: true,
        },
        {
          email: 'test@example.local',
          responseStatus: 'needsAction',
          optional: false,
        },
        {
          email: 'test@example.dev',
          responseStatus: 'accepted',
          optional: true,
        },
      ],
    }

    const list = vi.fn((calendarId: string, options: any) => ({
      items: [event],
      nextSyncToken: 'gotNextSyncToken',
    }))

    const update = vi.fn(
      (event: any, calendarId: string, eventId: string, options: any) => {
        return {
          start: { dateTime: '2020-01-01T00:00:00+09:00' },
          summary: 'updated event',
        }
      }
    )
    const emails = ['test@example.local', 'test@example.dev']

    mockPropertiesService({ email: emails.join(',') })
    mockCalendar({
      update,
      list,
    })

    const nextEvent = {
      ...event,
      attendees: [
        {
          email: 'user@example.com',
          self: true,
          responseStatus: 'accepted',
        },
        {
          email: 'other@example.com',
          responseStatus: 'accepted',
        },
        {
          email: 'other2@example.dev',
          responseStatus: 'needsAction',
          optional: true,
        },
        {
          email: 'test@example.local',
          responseStatus: 'accepted',
          optional: false,
        },
        {
          email: 'test@example.dev',
          responseStatus: 'accepted',
          optional: false,
        },
      ],
    }

    expect(main()).toBe(undefined)
    expect(update).toBeCalledTimes(0)
    // expect(update).toBeCalledWith(
    //   nextEvent,
    //   calendarId,
    //   id,
    //   {
    //     sendUpdates: 'none',
    //   },
    //   { 'If-Match': etag }
    // )
  })

  test('ターゲットが招待済みでも自身の状態に合わせる（update: 状態の同期は廃止）', () => {
    const event: Event = {
      id,
      etag,
      organizer: { self: true },
      attendees: [
        {
          email: 'user@example.com',
          self: true,
          responseStatus: 'declined',
        },
        {
          email: 'other@example.com',
          responseStatus: 'accepted',
        },
        {
          email: 'other2@example.dev',
          responseStatus: 'needsAction',
          optional: true,
        },
        {
          email: 'test@example.local',
          responseStatus: 'needsAction',
          optional: false,
        },
        {
          email: 'test@example.dev',
          responseStatus: 'accepted',
          optional: true,
        },
      ],
    }

    const list = vi.fn((calendarId: string, options: any) => ({
      items: [event],
      nextSyncToken: 'gotNextSyncToken',
    }))

    const update = vi.fn(
      (event: any, calendarId: string, eventId: string, options: any) => {
        return {
          start: { dateTime: '2020-01-01T00:00:00+09:00' },
          summary: 'updated event',
        }
      }
    )
    const emails = ['test@example.local', 'test@example.dev']

    mockPropertiesService({ email: emails.join(',') })
    mockCalendar({
      update,
      list,
    })

    const nextEvent = {
      ...event,
      attendees: [
        {
          email: 'user@example.com',
          self: true,
          responseStatus: 'declined',
        },
        {
          email: 'other@example.com',
          responseStatus: 'accepted',
        },
        {
          email: 'other2@example.dev',
          responseStatus: 'needsAction',
          optional: true,
        },
        {
          email: 'test@example.local',
          responseStatus: 'declined',
          optional: false,
        },
        {
          email: 'test@example.dev',
          responseStatus: 'declined',
          optional: false,
        },
      ],
    }

    expect(main()).toBe(undefined)
    expect(update).toBeCalledTimes(0)
    // expect(update).toBeCalledWith(
    //   nextEvent,
    //   calendarId,
    //   id,
    //   {
    //     sendUpdates: 'none',
    //   },
    //   { 'If-Match': etag }
    // )
  })

  test('その他のイベントデータはそのままアップデートに渡す', () => {
    const event: any = {
      id,
      etag,
      organizer: { self: true },
      some: 'data',
      the: {
        other: 'data',
      },
      attendees: [
        {
          email: 'a@b.c',
          self: true,
          responseStatus: 'accepted',
        },
      ],
    }

    const list = vi.fn((calendarId: string, options: any) => ({
      items: [event],
      nextSyncToken: 'gotNextSyncToken',
    }))

    const update = vi.fn(
      (event: any, calendarId: string, eventId: string, options: any) => {
        return {
          start: { dateTime: '2020-01-01T00:00:00+09:00' },
          summary: 'updated event',
        }
      }
    )
    const email = 'test@example.local'

    mockPropertiesService({ email })
    mockCalendar({
      update,
      list,
    })

    const nextEvent = {
      ...event,
      attendees: [
        {
          email: 'a@b.c',
          self: true,
          responseStatus: 'accepted',
        },
        {
          email,
          responseStatus: 'accepted',
          optional: false,
        },
      ],
    }

    expect(main()).toBe(undefined)
    expect(update).toBeCalled()
    expect(update).toBeCalledWith(
      nextEvent,
      calendarId,
      id,
      {
        sendUpdates: 'none',
      },
      { 'If-Match': etag }
    )
  })
})
