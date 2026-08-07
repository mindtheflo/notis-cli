# Random Number Generator

A simple, well-designed generator that lets you roll integers, decimals, or dice and keeps a history of every result in a Notis database.

## Manifest

- **Slug**: `notis-random`
- **Database**: `rolls` — each roll persists as one row with `Value`, `Mode`, `Min`, `Max`, and `Rolled At`.
- **Routes**: `/` (Generator) and `/history` (History, renders the `rolls` database as a flat collection).

## Database setup

`notis.config.ts` only references the `rolls` slug. It does not create the database schema automatically.

Provision the native schema before testing fresh installs:

```bash
notis db upsert --operation update --database-id <rolls-db-id> --properties '[
  {"name":"Value","type":"number","action":"add"},
  {"name":"Mode","type":"select","action":"add","config":{"options":[
    {"name":"Integer","color":"blue"},
    {"name":"Decimal","color":"purple"},
    {"name":"Dice","color":"orange"}
  ]}},
  {"name":"Min","type":"number","action":"add"},
  {"name":"Max","type":"number","action":"add"},
  {"name":"Rolled At","type":"date","action":"add"}
]'
```

## Properties

_None yet._ Once `app.properties` lands in the SDK, this app will declare `default_min`, `default_max`, and `default_mode` at install time.
