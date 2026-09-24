# Architecture

Route → Service → Data. A route translates between HTTP and the service; a service applies the
owner check and formats every date as ISO 8601; the data layer stores rows and knows nothing of
owners or HTTP. Errors are named classes in `src/server/errors.ts`.
