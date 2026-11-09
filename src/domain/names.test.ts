import { describe, expect, it } from 'vitest'
import {
  duplicateReason,
  findLikelyDuplicates,
  foldName,
  fullNameKey,
  initials,
  jaroWinkler,
  likelyDuplicate,
  lookupKeyForFullName,
  nameKey,
  nicknamesMatch,
  osaDistance,
  splitPastedName,
  splitPastedNames,
  suggestTwoPeopleSplit,
} from './names'

describe('foldName and nameKey', () => {
  it('removes accents and case', () => {
    expect(foldName('Zoë')).toBe('zoe')
    expect(foldName('ZOE')).toBe('zoe')
    expect(foldName('Renée')).toBe('renee')
    expect(foldName('José García')).toBe('jose garcia')
    expect(foldName('İlkay')).toBe('ilkay')
  })

  it('spells out letters that do not decompose', () => {
    expect(foldName('Łukasz')).toBe('lukasz')
    expect(foldName('Søren Østergaard')).toBe('soren ostergaard')
    expect(foldName('Weiß')).toBe('weiss')
    expect(foldName('Æsa Œuvre')).toBe('aesa oeuvre')
    expect(foldName('Đorđe Ðuro')).toBe('dorde duro')
    expect(foldName('Þóra')).toBe('thora')
    expect(foldName('Yıldız')).toBe('yildiz')
  })

  it('makes apostrophes plain, reads hyphens as spaces and drops full stops', () => {
    expect(foldName('O’Connor')).toBe("o'connor")
    expect(foldName('Oʼ Connor')).toBe("o' connor")
    expect(foldName("O'Connor")).toBe("o'connor")
    expect(foldName('Mary-Jane')).toBe('mary jane')
    expect(foldName('Mary–Jane')).toBe('mary jane')
    expect(foldName('St. John')).toBe('st john')
    expect(foldName('Smith Jr.')).toBe('smith jr')
  })

  it('collapses and trims spaces, including no-break spaces', () => {
    expect(foldName('  Anna   van   der Berg ')).toBe('anna van der berg')
    expect(foldName('')).toBe('')
  })

  it('treats composed and decomposed accents the same', () => {
    expect(foldName('Zoë')).toBe(foldName('Zoë'))
  })

  it('nameKey joins first and last with a bar', () => {
    expect(nameKey('Zoë', 'Kowalczyk')).toBe('zoe|kowalczyk')
    expect(nameKey('Zoe', 'KOWALCZYK')).toBe(nameKey('Zoë', 'Kowalczyk'))
    expect(nameKey('Łukasz', 'Nowak')).toBe(nameKey('Lukasz', 'Nowak'))
    expect(nameKey('Anna', 'van der Berg')).toBe('anna|van der berg')
  })

  it('nameKey matches the plain lower case form the fixtures and seed already store for ASCII names', () => {
    for (const [first, last] of [
      ['Sam', 'Lee'],
      ['Guest', 'One'],
      ['Ana', 'Ruiz'],
    ]) {
      expect(nameKey(first, last)).toBe(`${first}|${last}`.toLowerCase())
    }
  })

  it('a bar inside a name cannot fake another key', () => {
    expect(nameKey('a|b', 'c')).not.toBe(nameKey('a', 'b|c'))
  })

  it('fullNameKey and lookupKeyForFullName agree on any way of writing a full name', () => {
    const key = fullNameKey('Jane', 'Smith')
    expect(key).toBe('jane smith')
    expect(lookupKeyForFullName('Jane Smith')).toBe(key)
    expect(lookupKeyForFullName('Smith, Jane')).toBe(key)
    expect(lookupKeyForFullName('Mrs. Jane Smith')).toBe(key)
    expect(lookupKeyForFullName('  JANE   SMITH ')).toBe(key)
    expect(lookupKeyForFullName('Anna van der Berg')).toBe(fullNameKey('Anna', 'van der Berg'))
    expect(lookupKeyForFullName('Mary Ann Smith')).toBe(fullNameKey('Mary', 'Ann Smith'))
    expect(lookupKeyForFullName('John Smith Jr.')).toBe(fullNameKey('John', 'Smith Jr'))
  })
})

describe('jaroWinkler', () => {
  it('gives the textbook values', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.9611, 3)
    expect(jaroWinkler('dwayne', 'duane')).toBeCloseTo(0.84, 2)
    expect(jaroWinkler('dixon', 'dicksonx')).toBeCloseTo(0.8133, 3)
  })

  it('handles equal, empty and unrelated strings', () => {
    expect(jaroWinkler('anna', 'anna')).toBe(1)
    expect(jaroWinkler('', '')).toBe(1)
    expect(jaroWinkler('anna', '')).toBe(0)
    expect(jaroWinkler('abc', 'xyz')).toBe(0)
  })

  it('is symmetric', () => {
    expect(jaroWinkler('katherine', 'catherine')).toBeCloseTo(jaroWinkler('catherine', 'katherine'), 10)
  })
})

describe('osaDistance', () => {
  it('counts edits, with a swap of neighbors as one', () => {
    expect(osaDistance('jon', 'john')).toBe(1)
    expect(osaDistance('smtih', 'smith')).toBe(1)
    expect(osaDistance('kitten', 'sitting')).toBe(3)
    expect(osaDistance('ca', 'abc')).toBe(3)
    expect(osaDistance('', 'abc')).toBe(3)
    expect(osaDistance('abc', 'abc')).toBe(0)
  })

  it('stops early at max', () => {
    expect(osaDistance('anna', 'bartholomew', 2)).toBe(3)
    expect(osaDistance('katherine', 'catharine', 2)).toBe(2)
    expect(osaDistance('abcdef', 'ghijkl', 1)).toBe(2)
  })
})

/** Deterministic random integers below n (mulberry32). */
function seededRandom(seed: number) {
  let a = seed
  return (n: number) => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n)
  }
}

describe('likely duplicates', () => {
  const p = (firstName: string, lastName: string, nickname?: string) => ({ firstName, lastName, nickname })

  it('same name ignoring case and accents', () => {
    expect(duplicateReason(p('Zoë', 'Kowalczyk'), p('zoe', 'KOWALCZYK'))).toBe('same-name')
  })

  it('first and last swapped', () => {
    expect(duplicateReason(p('Lee', 'Chen'), p('Chen', 'Lee'))).toBe('swapped')
  })

  it('nicknames with the same last name', () => {
    expect(nicknamesMatch('bill', 'william')).toBe(true)
    expect(nicknamesMatch('bill', 'will')).toBe(true)
    expect(nicknamesMatch('samuel', 'samantha')).toBe(false)
    expect(duplicateReason(p('Bill', 'Smith'), p('William', 'Smith'))).toBe('nickname')
    expect(duplicateReason(p('Bob', 'Jones'), p('Robert', 'Jones'))).toBe('nickname')
    expect(duplicateReason(p('Liz', 'Park'), p('Elizabeth', 'Park'))).toBe('nickname')
    expect(duplicateReason(p('Kate', 'Ng'), p('Katherine', 'Ng'))).toBe('nickname')
    expect(duplicateReason(p('Mike', 'Ross'), p('Michael', 'Ross'))).toBe('nickname')
    expect(duplicateReason(p('Dan', 'Levi'), p('Daniel', 'Levi'))).toBe('nickname')
    expect(duplicateReason(p('Sam', 'Lee'), p('Samuel', 'Lee'))).toBe('nickname')
    expect(duplicateReason(p('Alex', 'Kim'), p('Alexander', 'Kim'))).toBe('nickname')
    expect(duplicateReason(p('Bill', 'Smith'), p('William', 'Jones'))).toBeNull()
  })

  it("counts a guest's nickname field", () => {
    expect(duplicateReason(p('Robert', 'Smith', 'Bobo'), p('Bobo', 'Smith'))).toBe('nickname')
  })

  it('close first names with the same last name', () => {
    expect(duplicateReason(p('Jon', 'Smith'), p('John', 'Smith'))).toBe('close-spelling')
    expect(duplicateReason(p('Ann', 'Lee'), p('Anne', 'Lee'))).toBe('close-spelling')
    expect(duplicateReason(p('Katherine', 'Ng'), p('Katharine', 'Ng'))).toBe('close-spelling')
    expect(duplicateReason(p('Sara', 'Cohen'), p('Sarah', 'Cohen'))).toBe('close-spelling')
  })

  it('does not flag siblings with short names one letter apart', () => {
    expect(duplicateReason(p('Tom', 'Lee'), p('Tim', 'Lee'))).toBeNull()
    expect(duplicateReason(p('Dan', 'Lee'), p('Don', 'Lee'))).toBeNull()
    expect(duplicateReason(p('Mia', 'Kowalczyk'), p('Zoë', 'Kowalczyk'))).toBeNull()
    expect(duplicateReason(p('Sam', 'Lee'), p('Theo', 'Lee'))).toBeNull()
  })

  it('whole names within 2 edits when 10 characters or more', () => {
    expect(duplicateReason(p('Katherine', 'Smyth'), p('Katharine', 'Smith'))).toBe('close-spelling')
    expect(duplicateReason(p('Anna', 'Kowalski'), p('Anna', 'Kowalsky'))).toBe('close-spelling')
    // Short names need the same last name: "Jo Li" and "Jo Le" are two people.
    expect(duplicateReason(p('Jo', 'Li'), p('Jo', 'Le'))).toBeNull()
    expect(likelyDuplicate(p('Priya', 'Raman'), p('Daniel', "O'Connor"))).toBe(false)
  })

  it('findLikelyDuplicates finds each pair once and agrees with duplicateReason', () => {
    const people = [
      { key: 'a', ...p('Jon', 'Smith') },
      { key: 'b', ...p('John', 'Smith') },
      { key: 'c', ...p('Chen', 'Lee') },
      { key: 'd', ...p('Lee', 'Chen') },
      { key: 'e', ...p('Katherine', 'Smyth') },
      { key: 'f', ...p('Katharine', 'Smith') },
      { key: 'g', ...p('Theo', 'Lee') },
    ]
    const pairs = findLikelyDuplicates(people)
    const ids = pairs.map((x) => `${x.a}${x.b}:${x.reason}`).sort()
    expect(ids).toEqual(['ab:close-spelling', 'cd:swapped', 'ef:close-spelling'])
    // Brute force agrees.
    const brute: string[] = []
    for (let i = 0; i < people.length; i++)
      for (let j = i + 1; j < people.length; j++) {
        const r = duplicateReason(people[i], people[j])
        if (r) brute.push(`${people[i].key}${people[j].key}:${r}`)
      }
    expect(brute.sort()).toEqual(ids)
  })

  it('findLikelyDuplicates keeps only pairs involving the given keys', () => {
    const people = [
      { key: 'old1', ...p('Jon', 'Smith') },
      { key: 'old2', ...p('John', 'Smith') },
      { key: 'new1', ...p('Johnny', 'Smith') },
    ]
    const pairs = findLikelyDuplicates(people, (k) => k.startsWith('new'))
    expect(pairs.every((x) => x.a === 'new1' || x.b === 'new1')).toBe(true)
    expect(pairs.some((x) => x.a === 'old1' && x.b === 'old2')).toBe(false)
  })

  it('findLikelyDuplicates matches brute force on a random list', () => {
    const firsts = ['Jon', 'John', 'Johnny', 'Ann', 'Anne', 'Anna', 'Bill', 'William', 'Kate', 'Katherine', 'Tom', 'Tim']
    const lasts = ['Smith', 'Smyth', 'Lee', 'Kowalski', 'Kowalsky', 'Chen', 'Tom', 'Anne']
    const rand = seededRandom(7)
    const people = Array.from({ length: 80 }, (_, i) => ({
      key: String(i),
      firstName: firsts[rand(firsts.length)],
      lastName: lasts[rand(lasts.length)],
    }))
    const fast = findLikelyDuplicates(people)
      .map((x) => `${x.a}-${x.b}-${x.reason}`)
      .sort()
    const brute: string[] = []
    for (let i = 0; i < people.length; i++)
      for (let j = i + 1; j < people.length; j++) {
        const r = duplicateReason(people[i], people[j])
        if (r) brute.push(`${i}-${j}-${r}`)
      }
    expect(fast).toEqual(brute.sort())
  })

  it('findLikelyDuplicates is quick on 5,000 new names against 1,000 guests', () => {
    const syllables = ['an', 'ber', 'cor', 'dan', 'el', 'fio', 'gra', 'hal', 'is', 'jo']
    const more = ['ka', 'lu', 'mar', 'no', 'ol', 'pe', 'ri', 'sa', 'tor', 'vi']
    syllables.push(...more)
    const rand = seededRandom(11)
    const word = (len: number) => Array.from({ length: len }, () => syllables[rand(syllables.length)]).join('')
    const people = Array.from({ length: 6000 }, (_, i) => ({
      key: i < 5000 ? `r${i}` : `g${i}`,
      firstName: word(2 + rand(2)),
      lastName: word(2 + rand(3)),
    }))
    const start = performance.now()
    findLikelyDuplicates(people, (k) => k.startsWith('r'))
    // Comparing every pair in full takes over a minute; the blocking keeps it near one second.
    expect(performance.now() - start).toBeLessThan(5000)
  })
})

describe('splitPastedName', () => {
  const split = (line: string) => {
    const r = splitPastedName(line)
    return [r.firstName, r.lastName, r.problem]
  }

  it('last word is the last name', () => {
    expect(split('Anna Lee')).toEqual(['Anna', 'Lee', null])
    expect(split('Mary Ann Smith')).toEqual(['Mary Ann', 'Smith', null])
    expect(split('  Zoë   Kowalczyk ')).toEqual(['Zoë', 'Kowalczyk', null])
  })

  it('a comma means Last, First', () => {
    expect(split('Smith, John')).toEqual(['John', 'Smith', null])
    expect(split('van der Berg, Anna')).toEqual(['Anna', 'van der Berg', null])
    expect(split('Smith Jr., John')).toEqual(['John', 'Smith Jr.', null])
    expect(split('Smith, Dr. John')).toEqual(['John', 'Smith', null])
  })

  it('particles start the last name', () => {
    expect(split('Anna van der Berg')).toEqual(['Anna', 'van der Berg', null])
    expect(split('Ludwig von Mises')).toEqual(['Ludwig', 'von Mises', null])
    expect(split('Maria de la Cruz')).toEqual(['Maria', 'de la Cruz', null])
    expect(split('Anna Maria Della Rosa')).toEqual(['Anna Maria', 'Della Rosa', null])
    expect(split('Leonardo da Vinci')).toEqual(['Leonardo', 'da Vinci', null])
    expect(split('David Ben Gurion')).toEqual(['David', 'Ben Gurion', null])
    expect(split('Omar al Farsi')).toEqual(['Omar', 'al Farsi', null])
    expect(split('Hans ter Horst')).toEqual(['Hans', 'ter Horst', null])
    expect(split('Jean du Pont')).toEqual(['Jean', 'du Pont', null])
  })

  it('a particle as the first word or the last word is just a name', () => {
    expect(split('Ben Stiller')).toEqual(['Ben', 'Stiller', null])
    expect(split('Al Green')).toEqual(['Al', 'Green', null])
    expect(split('Thi Le')).toEqual(['Thi', 'Le', null])
  })

  it('suffixes stay with the last name', () => {
    expect(split('John Smith Jr.')).toEqual(['John', 'Smith Jr.', null])
    expect(split('John Smith, Jr.')).toEqual(['John', 'Smith Jr.', null])
    expect(split('Smith, John, Jr.')).toEqual(['John', 'Smith Jr.', null])
    expect(split('Henry Ford III')).toEqual(['Henry', 'Ford III', null])
    expect(split('Sam Lee Sr')).toEqual(['Sam', 'Lee Sr', null])
    expect(split('Martin Luther King Jr')).toEqual(['Martin Luther', 'King Jr', null])
  })

  it('drops honorifics', () => {
    expect(split('Mr. John Smith')).toEqual(['John', 'Smith', null])
    expect(split('Mrs Jane Smith')).toEqual(['Jane', 'Smith', null])
    expect(split('Dr. Ana Ruiz')).toEqual(['Ana', 'Ruiz', null])
    expect(split('Mx Alex Kim')).toEqual(['Alex', 'Kim', null])
    expect(split('Ms. Lee')).toEqual(['Lee', '', 'Needs a last name'])
  })

  it('one word needs a last name', () => {
    expect(split('Madonna')).toEqual(['Madonna', '', 'Needs a last name'])
    expect(split('Smith,')).toEqual(['', 'Smith', 'Needs a first name'])
    expect(split('')).toEqual(['', '', 'Needs a name'])
  })

  it('flags two people', () => {
    expect(split('John & Jane Smith')).toEqual(['John & Jane', 'Smith', 'Two people? Split this line'])
    expect(split('John and Jane Smith')[2]).toBe('Two people? Split this line')
    expect(split('Smith, John AND Jane')[2]).toBe('Two people? Split this line')
    expect(split('Anderson Cooper')[2]).toBeNull()
    expect(split('Andy Sandberg')[2]).toBeNull()
  })

  it('reads two cells pasted from a spreadsheet as first and last', () => {
    expect(split('Anna Maria\tvan der Berg')).toEqual(['Anna Maria', 'van der Berg', null])
    expect(split('Anna\t\tLee\t')).toEqual(['Anna', 'Lee', null])
  })

  it('removes list bullets, numbering and quotes', () => {
    expect(split('- Anna Lee')).toEqual(['Anna', 'Lee', null])
    expect(split('• Anna Lee')).toEqual(['Anna', 'Lee', null])
    expect(split('12. Anna Lee')).toEqual(['Anna', 'Lee', null])
    expect(split('3) Anna Lee')).toEqual(['Anna', 'Lee', null])
    expect(split('"Anna Lee"')).toEqual(['Anna', 'Lee', null])
    expect(split('“Anna Lee”')).toEqual(['Anna', 'Lee', null])
    expect(split("Anna 'Lee'")).toEqual(['Anna', "'Lee'", null])
  })

  it('keeps apostrophes, hyphens and case as typed', () => {
    expect(split("Daniel O'Connor")).toEqual(['Daniel', "O'Connor", null])
    expect(split('Mary-Jane Smith-Jones')).toEqual(['Mary-Jane', 'Smith-Jones', null])
    expect(split('anna lee')).toEqual(['anna', 'lee', null])
  })

  it('removes NUL characters', () => {
    expect(split('An\u0000na Lee')).toEqual(['Anna', 'Lee', null])
  })

  it('splitPastedNames gives one entry per non-blank line (acceptance 25: 10 names)', () => {
    const text = [
      'Anna Lee',
      'Smith, John',
      '',
      'Zoë Kowalczyk',
      'Łukasz Kowalczyk',
      '   ',
      'Anna van der Berg',
      'Daniel O’Connor',
      'Priya Raman',
      'José García',
      'Renée Dubois',
      'Theo Lee',
    ].join('\r\n')
    const result = splitPastedNames(text)
    expect(result).toHaveLength(10)
    expect(result.every((r) => r.problem === null)).toBe(true)
    expect(result[1]).toMatchObject({ firstName: 'John', lastName: 'Smith', source: 'Smith, John' })
  })
})

describe('suggestTwoPeopleSplit', () => {
  it('shares the last name', () => {
    expect(suggestTwoPeopleSplit('John & Jane Smith')).toEqual(['John Smith', 'Jane Smith'])
    expect(suggestTwoPeopleSplit('Mr and Mrs John Smith')).toBeNull()
    expect(suggestTwoPeopleSplit('Smith, John and Jane')).toEqual(['John Smith', 'Jane Smith'])
    expect(suggestTwoPeopleSplit('John Smith & Jane')).toEqual(['John Smith', 'Jane Smith'])
  })

  it('keeps two full names apart', () => {
    expect(suggestTwoPeopleSplit('Anna Berg and Tom Lee')).toEqual(['Anna Berg', 'Tom Lee'])
    expect(suggestTwoPeopleSplit('Anna van der Berg & Tom Lee')).toEqual(['Anna van der Berg', 'Tom Lee'])
  })

  it('gives null for one person', () => {
    expect(suggestTwoPeopleSplit('Anna Lee')).toBeNull()
  })
})

describe('initials', () => {
  it('takes the first letter of each name', () => {
    expect(initials('Anna', 'Berg')).toBe('AB')
    expect(initials('zoë', 'kowalczyk')).toBe('ZK')
    expect(initials('Łukasz', 'Ńowak')).toBe('ŁŃ')
    expect(initials('Anna', 'van der Berg')).toBe('AV')
    expect(initials('Daniel', "'O'Connor")).toBe('DO')
    expect(initials('', 'Lee')).toBe('L')
  })
})
