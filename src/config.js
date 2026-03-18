// Application configuration — field schema and cross-field validation.
//
// COLUMN_CONFIG is the single source of truth for every piece of data the app
// handles. It drives: column header matching, spreadsheet validation, XML
// generation, and the Column Mapping Review UI. To add, remove, or rename a
// field, edit this array only — no other file needs to change.
//
// RECORD_VALIDATOR contains cross-field business rules that can't be expressed
// per-field (e.g. "field A is only valid when field B has a specific value").

// ---------------------------------------------------------------------------
// COLUMN_CONFIG — array of field descriptor objects.
//
// Each object has the following shape:
//
//   fieldName  {string}
//     Human-readable name. Used as the key throughout the app (store objects,
//     resolved row objects, UI labels). Must be unique.
//
//   xpath  {string}
//     Where to write the value in the output XML, relative to <Publication>.
//     Supported notation:
//       @attr                         → attribute on <Publication>
//       ChildElement                  → child element text content
//       Parent/Child/@attr            → attribute on a nested element
//       Parent/Child/Element[n]/@attr → attribute on a zero-based indexed element
//     See lib/xml.js setXPathValue() for the full parser.
//
//   type  {'string' | 'datetime' | 'boolean' | 'enum'}
//     Controls validation and value resolution:
//       string   — any non-empty string
//       datetime — must be a Date cell in the spreadsheet (not plain text);
//                  output as ISO 8601 UTC string
//       boolean  — native boolean cell OR: true/false, yes/no, y/n, 1/0 (case-insensitive);
//                  output as "true" or "false"
//       enum     — must exactly match one of the values in enumValues
//
//   enumValues  {string[]}  (only for type:'enum')
//     Permitted values. Case-sensitive.
//
//   mandatory  {boolean}
//     If true, the field must be mapped to a column and the cell must be non-empty.
//     Mandatory fields that are missing block the upload entirely.
//
//   default  {string | null | (resolvedRowSoFar) => string | null}
//     Value to use when the field is unmapped or the cell is empty.
//     Can be a literal string, null (omit from XML), or a function that
//     receives the partially-resolved row object and returns a derived value.
//     Function defaults allow one field to fall back to another
//     (e.g. Channel ID defaults to Channel Label).
//
//   aliases  {string[]}
//     Column header strings that should be matched to this field during
//     auto-mapping. Matching is fuzzy (Levenshtein distance ≤ 3), so minor
//     typos and abbreviations are handled automatically. The first alias is
//     conventionally the canonical/preferred name.
//     Users can add more aliases at runtime via the learned aliases feature
//     (see lib/learnedAliases.js).
// ---------------------------------------------------------------------------
export const COLUMN_CONFIG = [
  {
    fieldName: 'Publication ID',
    xpath:     '@publicationId',      // → <Publication publicationId="…">
    type:      'string',
    mandatory: true,
    default:   null,
    aliases: ['Publication ID', 'PublicationID', 'Publication Id', 'Pub ID', 'PubID'],
  },
  {
    fieldName: 'Episode ID',
    xpath:     '@episodeId',          // → <Publication episodeId="…">
    type:      'string',
    mandatory: true,
    default:   null,
    aliases: ['Episode ID', 'EpisodeID', 'Episode Id', 'Ep ID', 'EpID'],
  },
  {
    fieldName:  'Availability Mode',
    xpath:      '@availabilityMode',  // → <Publication availabilityMode="…">
    type:       'enum',
    enumValues: ['broadcast', 'onDemand'],  // case-sensitive; exactly these two values
    mandatory:  true,
    default:    null,
    aliases: ['Availability Mode', 'AvailabilityMode', 'Avail Mode', 'Mode'],
  },
  {
    fieldName: 'Is Repeat?',
    xpath:     '@isRepeat',           // → <Publication isRepeat="…">
    type:      'boolean',
    mandatory: false,
    default:   'true',               // most broadcasts are repeats; default is safer
    aliases: ['Is Repeat?', 'Is Repeat', 'IsRepeat', 'Repeat', 'Repeat?'],
  },
  {
    fieldName: 'Is Primary?',
    xpath:     '@isPrimary',          // → <Publication isPrimary="…">
    type:      'boolean',
    mandatory: false,
    default:   'false',
    aliases: ['Is Primary?', 'Is Primary', 'IsPrimary', 'Primary', 'Primary?'],
  },
  {
    fieldName: 'Publication Date and Time',
    xpath:     'PublicationDateTime', // → <PublicationDateTime>…</PublicationDateTime>
    type:      'datetime',
    mandatory: true,
    default:   null,
    aliases: [
      'Publication Date and Time', 'Publication DateTime', 'PublicationDateTime',
      'TX Date', 'TX DateTime', 'Transmission Date', 'Pub Date',
    ],
  },
  {
    fieldName: 'Window Closure Date and Time',
    xpath:     'WindowClosureDateTime', // → <WindowClosureDateTime>…</WindowClosureDateTime>
    type:      'datetime',
    mandatory: false,
    default:   null,
    // RECORD_VALIDATOR below enforces that this is only used with availabilityMode=onDemand
    aliases: [
      'Window Closure Date and Time', 'Window Closure DateTime',
      'WindowClosureDateTime', 'Window Close', 'Closure Date', 'End Date',
    ],
  },
  {
    fieldName: 'Channel Label',
    xpath:     'ChannelPlatforms/ChannelPlatform/@label',
    type:      'string',
    mandatory: true,
    default:   null,
    aliases: ['Channel Label', 'Channel Name', 'ChannelLabel', 'Channel', 'Platform'],
  },
  {
    fieldName: 'Channel ID',
    xpath:     'ChannelPlatforms/ChannelPlatform/@id',
    type:      'string',
    mandatory: false,
    // Function default: if no Channel ID column exists, reuse the Channel Label value
    default:   (row) => row['Channel Label'],
    aliases: ['Channel ID', 'ChannelID', 'Channel Id', 'Channel Code'],
  },
  // Sub-channels — up to four regional variants per channel platform.
  // SubChannel[n] uses zero-based indexing in the xpath notation.
  // A SubChannel element is only written to XML when its label is non-empty;
  // the ID falls back to the label if omitted (same pattern as Channel ID above).
  {
    fieldName: 'Sub-channel 1 Label',
    xpath:     'ChannelPlatforms/ChannelPlatform/SubChannel[0]/@label',
    type:      'string',
    mandatory: false,
    default:   null,
    aliases: ['Sub-channel 1 Label', 'SubChannel 1 Label', 'Sub-channel 1', 'Sub Channel 1 Label', 'Region 1'],
  },
  {
    fieldName: 'Sub-channel 1 ID',
    xpath:     'ChannelPlatforms/ChannelPlatform/SubChannel[0]/@id',
    type:      'string',
    mandatory: false,
    default:   (row) => row['Sub-channel 1 Label'],
    aliases: ['Sub-channel 1 ID', 'SubChannel 1 ID', 'Sub-channel 1 Id', 'Sub Channel 1 ID', 'Region 1 ID'],
  },
  {
    fieldName: 'Sub-channel 2 Label',
    xpath:     'ChannelPlatforms/ChannelPlatform/SubChannel[1]/@label',
    type:      'string',
    mandatory: false,
    default:   null,
    aliases: ['Sub-channel 2 Label', 'SubChannel 2 Label', 'Sub-channel 2', 'Sub Channel 2 Label', 'Region 2'],
  },
  {
    fieldName: 'Sub-channel 2 ID',
    xpath:     'ChannelPlatforms/ChannelPlatform/SubChannel[1]/@id',
    type:      'string',
    mandatory: false,
    default:   (row) => row['Sub-channel 2 Label'],
    aliases: ['Sub-channel 2 ID', 'SubChannel 2 ID', 'Sub-channel 2 Id', 'Sub Channel 2 ID', 'Region 2 ID'],
  },
  {
    fieldName: 'Sub-channel 3 Label',
    xpath:     'ChannelPlatforms/ChannelPlatform/SubChannel[2]/@label',
    type:      'string',
    mandatory: false,
    default:   null,
    aliases: ['Sub-channel 3 Label', 'SubChannel 3 Label', 'Sub-channel 3', 'Sub Channel 3 Label', 'Region 3'],
  },
  {
    fieldName: 'Sub-channel 3 ID',
    xpath:     'ChannelPlatforms/ChannelPlatform/SubChannel[2]/@id',
    type:      'string',
    mandatory: false,
    default:   (row) => row['Sub-channel 3 Label'],
    aliases: ['Sub-channel 3 ID', 'SubChannel 3 ID', 'Sub-channel 3 Id', 'Sub Channel 3 ID', 'Region 3 ID'],
  },
  {
    fieldName: 'Sub-channel 4 Label',
    xpath:     'ChannelPlatforms/ChannelPlatform/SubChannel[3]/@label',
    type:      'string',
    mandatory: false,
    default:   null,
    aliases: ['Sub-channel 4 Label', 'SubChannel 4 Label', 'Sub-channel 4', 'Sub Channel 4 Label', 'Region 4'],
  },
  {
    fieldName: 'Sub-channel 4 ID',
    xpath:     'ChannelPlatforms/ChannelPlatform/SubChannel[3]/@id',
    type:      'string',
    mandatory: false,
    default:   (row) => row['Sub-channel 4 Label'],
    aliases: ['Sub-channel 4 ID', 'SubChannel 4 ID', 'Sub-channel 4 Id', 'Sub Channel 4 ID', 'Region 4 ID'],
  },
];

// ---------------------------------------------------------------------------
// RECORD_VALIDATOR — cross-field business rules.
//
// Called by validateRows() after all individual field checks pass for a row.
// Receives the fully-resolved field values (XML-ready strings).
//
// Returns true if the record is valid, or an error string describing the problem.
//
// Add additional cross-field rules here as new requirements emerge.
// ---------------------------------------------------------------------------
export const RECORD_VALIDATOR = (fields) => {
  // WindowClosureDateTime is only meaningful for on-demand content.
  // Including it on a broadcast row would produce invalid XML for TEP.
  if (
    fields['Window Closure Date and Time'] &&
    fields['Availability Mode'] !== 'onDemand'
  ) {
    return 'Window Closure Date and Time is only valid when Availability Mode is "onDemand"';
  }
  return true;
};
