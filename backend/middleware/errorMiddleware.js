const notFound = (req, res, next) => {
  res.status(404);
  next(new Error(`Not found: ${req.originalUrl}`));
};

const errorHandler = (err, req, res, next) => {
  let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  let message = err.message || "Something went wrong.";

  // express.json() throws a SyntaxError with a status already attached. Left
  // unclassified it surfaces as a 500, which reports a client's malformed
  // body as a server fault and buries real failures in the logs.
  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    statusCode = 400;
    message = "That request body was not valid JSON.";
  } else if (err.type === "entity.too.large") {
    statusCode = 413;
    message = "That request was too large.";
  } else if (err.name === "CastError" && err.kind === "ObjectId") {
    statusCode = 404;
    message = "Resource not found.";
  } else if (err.name === "ValidationError") {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(", ");
  } else if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "value";
    statusCode = 409;
    message = `That ${field} is already in use.`;
  } else if (err.statusCode) {
    // Errors raised by the ai service carry their own status.
    statusCode = err.statusCode;
  }

  // A stack trace in a production response leaks file paths and package
  // versions, so it is attached only outside production.
  const body = { message };
  if (process.env.NODE_ENV !== "production") {
    body.stack = err.stack;
  }

  res.status(statusCode).json(body);
};

module.exports = { notFound, errorHandler };
