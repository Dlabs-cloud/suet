const dbo = require('../lib/db.js')
    , moment = require('moment')
    ;

exports.getAll = (domain, options, fn)  => {
  if (!domain)
    return fn('Domain not specified');

  options = options || {};
  let limit = options.limit || 20;
  let skip = options.offset || 0;
  let sort = 'last_seen'
      , order = -1
      , allowedSort = ['last_seen', 'email', 'clicked', 'opened', 'delivered']
      ;
  if (options.sort && allowedSort.indexOf(options.sort) != -1)
    sort = options.sort;
  if (options.dir && options.dir == 'asc')
    order = 1;

  let qs = {limit: limit, skip: parseInt(skip), sort: {}};
  qs.sort[sort] = order;

  let p = new Promise((resolve, reject) => {
    dbo.db().collection('users').count({domain: domain}, (err, c) => {
      if (err)
        return reject(err);

      resolve(c);
    });
  })
  .then(total => {
    dbo.db().collection('users').find({domain: domain}, qs).toArray((err, docs) => {
      if (err) {
        console.log(err);
        return fn('Internal Error');
      }

      fn(null, {
        total: total,
        count: docs.length,
        offset: skip,
        limit: limit,
        data: docs
      });
    });
  })
  .catch(err => {
    fn(err);
  });
}

exports.getCold = (domain, options, fn)  => {
  if (!domain)
    return fn('Domain not specified');

  options = options || {};
  let limit = options.limit || 20;
  let skip = options.offset || 0;
  let sort = 'last_seen'
      , order = -1
      , allowedSort = ['last_seen', 'email', 'clicked', 'opened', 'delivered']
      ;
  if (options.sort && allowedSort.indexOf(options.sort) != -1)
    sort = options.sort;
  if (options.dir && options.dir == 'asc')
    order = 1;

  let qs = {limit: limit, skip: parseInt(skip), sort: {}};
  qs.sort[sort] = order;

  let p, days, dateAgo;
  if (options.days) {
    days = +options.days;
    p = Promise.resolve();
  }
  else {
    p = new Promise((resolve, reject) => {
      // Get last day mail was sent
      dbo.db().collection('mails').find({domain: domain}, {limit: 1, sort: {date: -1}}).toArray((err, mail) => {
        if (err)
          return reject(err);

        days = mail.length ? moment().diff(mail[0].date, 'days') + 30 : 30;

        resolve();
      });
    })
  }

  p.then(() => {
    dateAgo = moment().subtract(days, 'days').toDate();
    return new Promise((resolve, reject) => {
      dbo.db().collection('users').count({domain: domain, last_seen: {'$lte': dateAgo}}, (err, c) => {
        if (err)
          return reject(err);

        resolve(c);
      })
    });
  })
  .then(total => {
    dbo.db().collection('users').find({domain: domain, last_seen: {'$lte': dateAgo}}, qs).toArray((err, docs) => {
      if (err) {
        console.log(err);
        return fn('Internal Error');
      }

      fn(null, {
        total: total,
        count: docs.length,
        offset: skip,
        limit: limit,
        days: days,
        data: docs
      });
    });
  })
  .catch(err => {
    fn(err);
  });
}

exports.get = (email, domain, fn) => {
  if (!domain)
    return fn('Domain not specified');
  if (!email)
    return fn('User not specified');

  let q = [
    {$match: {email: email, domain: domain}},
    {$lookup: {
      from: 'mails',
      localField: 'msg_id',
      foreignField: 'msg_id',
      as: 'mail'
    }},
    {$unwind: '$mail'},
    {$sort: {date: -1}}
  ];

  dbo.db().collection('logs').aggregate(q).toArray((err, logs) => {
    if (err) {
      console.log(err);
      return fn('Internal Error');
    }

    let deliveries = 0,
        opens = 0,
        msg_ids = [],
        urls = [],
        clicks = 0;

    for (let l of logs) {
      l.subject = l.mail.subject;
      delete l.mail.subject;
      if (l.event == 'delivered')
        deliveries++;
      if (l.event == 'clicked') {
        if (urls.indexOf(l.url) == -1)
          urls.push(l.url);
        clicks++;
      }
      if (l.event == 'opened') {
        if (msg_ids.indexOf(l.msg_id) == -1)
          msg_ids.push(l.msg_id);
        opens++;
      }
    }

    fn(null, {
      email: email,
      opens: opens,
      unique_opens: msg_ids.length,
      clicks: clicks,
      urls: urls,
      deliveries: deliveries,
      logs: logs
    });

  });
}
