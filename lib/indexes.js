// Index collections

module.exports = dbo => {
  // Accounts
  dbo.db().collection("accounts").ensureIndex("owner");
  dbo.db().collection("accounts").ensureIndex("email");
  // Domains
  dbo.db().collection("domains").ensureIndex("domain");
  dbo.db().collection("domains").ensureIndex("accs");
  // Recover
  dbo.db().collection("recover").ensureIndex({uid: 1, hash: 1});
  // Logs
  dbo.db().collection("logs").ensureIndex("domain");
  dbo.db().collection("logs").ensureIndex({msg_id: 1, domain: 1});
  // This covers sort and match by email and domain
  dbo.db().collection("logs").ensureIndex({domain: 1, email: 1});
  dbo.db().collection("logs").ensureIndex({domain: 1, event: 1});
  dbo.db().collection("logs").ensureIndex({domain: 1, date: 1});
  dbo.db().collection("logs").ensureIndex({domain: 1, tags: 1}, {partialFilterExpression: {tags: {$exists: true}}});
  dbo.db().collection("logs").ensureIndex({url: 1}, {sparse: true});
  // Mails
  dbo.db().collection("mails").ensureIndex("domain");
  dbo.db().collection("mails").ensureIndex({msg_id: 1, domain: 1});
  dbo.db().collection("mails").ensureIndex({domain: 1, date: -1});
  dbo.db().collection("mails").ensureIndex({domain: 1, clicked: 1});
  dbo.db().collection("mails").ensureIndex({domain: 1, opened: 1});
  dbo.db().collection("mails").ensureIndex({domain: 1, tags: 1}, {partialFilterExpression: {tags: {$exists: true}}});
  // Users
  dbo.db().collection("users").ensureIndex("domain");
  dbo.db().collection("users").ensureIndex({domain: 1, last_seen: -1});
  dbo.db().collection("users").ensureIndex({domain: 1, email: 1});
  dbo.db().collection("users").ensureIndex({domain: 1, opened: 1});
  dbo.db().collection("users").ensureIndex({domain: 1, delivered: 1});
  dbo.db().collection("users").ensureIndex({domain: 1, clicked: 1});
  // Signatures
  dbo.db().collection("signatures").ensureIndex({signature: 1, domain: 1});
}
