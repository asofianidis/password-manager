import { describe, expect, it } from 'vitest'
import { detectFormat, duplicateKey, parseImport } from '../src/shared/importers'

const DASHLANE = `username,username2,username3,title,password,note,url,category,otpUrl
alice@example.com,,,GitHub,hunter2,"my note",https://github.com,Dev,otpauth://totp/x?secret=ABC
,bob,,,pw2,,https://www.example.org,,
`

const CHROME = `name,url,username,password,note
example.com,https://example.com/login,me,secret,
`

const FIREFOX = `"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"
"https://site.test","u","p",,"https://site.test","{1}","1","1","1"
`

const BITWARDEN_CSV = `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
Work,1,login,Jira,,custom: value,0,https://jira.test,jim,pw,
,,note,Secret note,text,,0,,,,
`

const LASTPASS = `url,username,password,totp,extra,name,grouping,fav
https://lp.test,lu,lp,,extra notes,LP Site,Social,1
`

const KEEPASS = `"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"
"Root","KP","ku","kp","https://kp.test","","","0","",""
`

const BITWARDEN_JSON = JSON.stringify({
  encrypted: false,
  folders: [{ id: 'f1', name: 'Personal' }],
  items: [
    {
      type: 1,
      name: 'Mail',
      folderId: 'f1',
      favorite: true,
      notes: null,
      login: { username: 'm', password: 'mp', totp: null, uris: [{ uri: 'https://mail.test' }] }
    },
    { type: 2, name: 'Note' }
  ]
})

const ONEPUX = JSON.stringify({
  accounts: [
    {
      vaults: [
        {
          attrs: { name: 'Private' },
          items: [
            {
              categoryUuid: '001',
              state: 'active',
              favIndex: 1,
              createdAt: 1700000000,
              updatedAt: 1700000100,
              overview: { title: 'Amazon', url: 'https://amazon.com' },
              details: {
                loginFields: [
                  { designation: 'username', value: 'shopper' },
                  { designation: 'password', value: 'buy' }
                ],
                notesPlain: 'n'
              }
            },
            { categoryUuid: '003', state: 'active', overview: { title: 'Secure note' } }
          ]
        }
      ]
    }
  ]
})

describe('detectFormat', () => {
  it.each([
    [DASHLANE, 'dashlane-csv'],
    [CHROME, 'chrome-csv'],
    [FIREFOX, 'firefox-csv'],
    [BITWARDEN_CSV, 'bitwarden-csv'],
    [LASTPASS, 'lastpass-csv'],
    [KEEPASS, 'keepass-csv'],
    [BITWARDEN_JSON, 'bitwarden-json'],
    [ONEPUX, '1password-1pux'],
    ['title,url,username,password\nx,y,z,w\n', 'generic-csv']
  ])('detects %#', (text, format) => {
    expect(detectFormat('export.csv', text)).toBe(format)
  })
})

describe('parseImport', () => {
  it('parses Dashlane CSV, falling back to the URL host for missing titles', () => {
    const { entries } = parseImport('dashlane-csv', DASHLANE)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      title: 'GitHub',
      username: 'alice@example.com',
      password: 'hunter2',
      notes: 'my note',
      folder: 'Dev',
      totp: 'otpauth://totp/x?secret=ABC'
    })
    expect(entries[1]).toMatchObject({ title: 'example.org', username: 'bob', password: 'pw2' })
  })

  it('parses Chrome CSV', () => {
    expect(parseImport('chrome-csv', CHROME).entries[0]).toMatchObject({
      title: 'example.com',
      username: 'me',
      password: 'secret'
    })
  })

  it('skips non-login Bitwarden items and keeps custom fields in notes', () => {
    const { entries, warnings } = parseImport('bitwarden-csv', BITWARDEN_CSV)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      title: 'Jira',
      favorite: true,
      folder: 'Work',
      notes: 'custom: value'
    })
    expect(warnings[0]).toMatch(/1 non-login/)
  })

  it('parses Bitwarden JSON with folder names', () => {
    const { entries } = parseImport('bitwarden-json', BITWARDEN_JSON)
    expect(entries).toEqual([
      expect.objectContaining({
        title: 'Mail',
        folder: 'Personal',
        url: 'https://mail.test',
        favorite: true
      })
    ])
  })

  it('parses 1Password 1PUX logins only', () => {
    const { entries } = parseImport('1password-1pux', ONEPUX)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      title: 'Amazon',
      username: 'shopper',
      password: 'buy',
      folder: 'Private',
      favorite: true,
      createdAt: 1700000000000
    })
  })

  it('parses LastPass and KeePass', () => {
    expect(parseImport('lastpass-csv', LASTPASS).entries[0]).toMatchObject({
      title: 'LP Site',
      notes: 'extra notes',
      folder: 'Social',
      favorite: true
    })
    expect(parseImport('keepass-csv', KEEPASS).entries[0]).toMatchObject({
      title: 'KP',
      folder: 'Root'
    })
  })
})

describe('duplicateKey', () => {
  it('ignores www and URL paths', () => {
    expect(duplicateKey({ url: 'https://www.a.com/login', username: 'U', password: 'p' })).toBe(
      duplicateKey({ url: 'a.com', username: 'u', password: 'p' })
    )
  })
})
