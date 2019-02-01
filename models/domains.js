const dbo = require('../lib/db.js')
    , encrypt = require('../lib/utils.js').encrypt
    , decrypt = require('../lib/utils.js').decrypt
    , request = require('request')
    , elasticsearch = require('elasticsearch')
    , esc = new elasticsearch.Client({
      host: process.env.ES_HOST,
      httpAuth: process.env.ES_AUTH,
      log: 'error'
    })
    , AWS = require('aws-sdk')
    ;

// Get list of domains connected to account
exports.get = (accId, fn) => {
  if (!accId)
    return fn('Invalid account');
  dbo.db().collection('domains').find({
    accs: dbo.id(accId)
  }, {sort: {domain: 1}}).toArray((err, docs) => {
    if (err) {
      return fn('Internal Error');
    }

    fn(null, docs);
  });
}

// Get a domain
exports.getOne = (accId, domain, fn) => {
  if (!accId)
    return fn('Invalid account');
  if (!domain)
    return fn('Invalid domain');
  dbo.db().collection('domains').findOne({
    accs: dbo.id(accId),
    domain: domain
  }, (err, doc) => {
    if (err)
      return fn('Internal Error');

    if (!doc)
      return fn();

    doc.owner = doc.owner.toHexString();

    dbo.db().collection('accounts').find({_id: {$in: doc.accs}}).toArray((err, users)=> {
      doc.users = [];
      for (let user of users) {
        doc.users.push({
          id: user._id.toHexString(),
          email: user.email
        });
      }
      fn(null, doc);
    });
  });
}

// Get domains from Mailgun
exports.getMGDomains = (accId, key, fn) => {

  if (!accId)
    return fn('Invalid account');
  if (!key)
    return fn('You missed the API key.');

  accId = dbo.id(accId);
  dbo.db().collection('accounts').findOne({_id: accId}, (err, doc) => {
    if (!doc)
      return fn('Invalid account');

    // Validate API key and get domains
    request.get({
      'url': 'https://api.mailgun.net/v3/domains',
      'gzip': true,
      'auth': {
        'user': 'api',
        'pass': key
      }
    }, (err, response, body) => {

      if (err || response.statusCode != 200) {
        return fn('Error validating your Mailgun API key. Please try again later.');
      }

      body = JSON.parse(body);

      if (body && body.items) {
        if (body.items.length == 0)
          return fn('No domains found in your account');

        let domains = [];
        for (var domain of body.items) {
          // Save domains in account
          domains.push(domain.name);
        }

        // Get webhooks
        Promise.all(domains.map(domain => {
            return new Promise(resolve => {
              request.get({
                'url': ['https://api.mailgun.net/v3/domains/', domain, '/webhooks'].join(''),
                'gzip': true,
                'auth': {
                  'user': 'api',
                  'pass': key,
                  'sendImmediately': false
                }
              }, (err, response, body) => {
                let obj = {name: domain};
                if (err && response.statusCode != 200) {
                  obj.error = true;
                  return resolve(obj);
                }

                body = JSON.parse(body);
                if (body.webhooks) {
                  // Has webhooks set and not just unsubscribe webhook (not used)
                  if (Object.keys(body.webhooks).length > 1 ||
                    (Object.keys(body.webhooks).length == 1 && !body.webhooks.unsubscribe)) {
                    obj.has_webhook = true;
                    obj.hooks = [];
                    for (let hook in body.webhooks) {
                      obj.hooks.push(hook);
                    }
                  }
                }

                return resolve(obj);
              });
            });
          })
        ).then(domains => {
          return fn(null, domains);
        });
      }
      else
        return fn('There has been an error getting the domains. Try again later');
    });
  });
}
// Setup domains from Mailgun
exports.setupMGDomains = (accId, key, domains, domainHooks, fn) => {

  if (!accId)
    return fn('Invalid account');
  if (!domains || !Array.isArray(domains))
    return fn('Select one or more domains.');
  if (domains.length < 1)
    return fn('Select one or more domains.');

  accId = dbo.id(accId);
  let encryptedKey = encrypt(key);
  dbo.db().collection('accounts').findOne({_id: accId}, (err, doc) => {
    if (!doc)
      return fn('Invalid account');

    let addedDomains = [];
    let hooks = ['temporary_fail', 'delivered', 'permanent_fail', 'complained', 'clicked', 'opened'];
    // Update webhooks
    Promise.all(domains.map(domain => {
      return new Promise(resolve => {
        let endpoint = `https://api.mailgun.net/v3/domains/${domain}/webhooks`;
        Promise.all(hooks.map(hook => {
          return new Promise(resolveInner => {
            request.post({
              url: endpoint,
              gzip: true,
              auth: {
                user: 'api',
                pass: key,
                sendImmediately: false
              },
              form: {
                id: hook,
                domain: domain,
                url: process.env.WEBHOOK
              }
            }, (err, response, body) => {
              // So how do we even handle errors here? :/
              resolveInner();
            });
          });
        })).then(() => {
          // Hooks updated, add to db
          dbo.db().collection('domains').updateOne({
            domain: domain
          }, {
            $addToSet: {accs: accId},
            $set: {
              key: encryptedKey,
              type: 'mg',
              owner: accId
            }
          }, {upsert: true}, err => {
            if (!err)
              addedDomains.push(domain);

            return resolve();
          });

        }).catch(e => {
          return resolve();
        });
      });
    })).then(() => {
      return fn(null, addedDomains);
    }).catch(() => {
      return fn(null, addedDomains);
    });
  });
}

// Get domains from SES
exports.getSESDomains = (accId, key, fn) => {

  if (!accId)
    return fn('Invalid account');
  if (!key)
    return fn('You missed the API key.');
  if (!key.id || !key.secret)
    return fn('Invalid key details.');

  accId = dbo.id(accId);
  dbo.db().collection('accounts').findOne({_id: accId}, (err, doc) => {
    if (!doc)
      return fn('Invalid account');

    // Validate API key and get domains
    const ses = new AWS.SES({
      accessKeyId: key.id,
      secretAccessKey: key.secret,
      region: key.region
    });
    ses.listIdentities({IdentityType: 'Domain'}, (err, body) => {
      if (err) {
        //console.log(err);
        return fn(err.message);
      }

      //console.log(body);
      //body = JSON.parse(body);
      return fn(null, body.Identities);

    });
    //return fn(null, []);
  });
}
// Setup SES domains
exports.setupSESDomains = (accId, key, domains, fn) => {

  if (!accId)
    return fn('Invalid account');
  if (!domains || !Array.isArray(domains))
    return fn('Select one or more domains.');
  if (domains.length < 1)
    return fn('Select one or more domains.');

  accId = dbo.id(accId);
  let addedDomains = [],
      topicArn = '';
  //let encryptedKey = encrypt(key);
  dbo.db().collection('accounts').findOne({_id: accId}, (err, doc) => {
    if (!doc)
      return fn('Invalid account');

    const ses = new AWS.SES({
      accessKeyId: key.id,
      secretAccessKey: key.secret,
      region: key.region
    });
    const sns = new AWS.SNS({
      accessKeyId: key.id,
      secretAccessKey: key.secret,
      region: key.region
    });

    new Promise((resolve, reject) => {
      // 1. Create topic (action is indempodent. If topic exists, not created)
      sns.createTopic({
        Name: process.env.SES_TOPIC
      }, (err, data) => {
        if (err) {
          return fn(err.message);
        }

        topicArn = data.TopicArn;

        // 2. Create subscription
        sns.subscribe({
          Protocol: process.env.SES_WEBHOOK.split(':')[0],
          TopicArn: topicArn,
          Attributes: {},
          Endpoint: process.env.SES_WEBHOOK,
          ReturnSubscriptionArn: true
        }, function(err, data) {
          if (err) {
            return fn(err.message);
          }

          // 3. Create configuration set
          ses.createConfigurationSet({
            ConfigurationSet: {
              Name: process.env.SES_CONFSET
            }
          }, function(err, data) {

            if (err) {
              if (err.code == 'ConfigurationSetAlreadyExists') {
                return resolve();
              }

              return fn(err.message);
            }

            // 4. Create event destination
            ses.createConfigurationSetEventDestination({
              ConfigurationSetName: process.env.SES_CONFSET,
              EventDestination: {
                MatchingEventTypes: [
                  'reject', 'bounce', 'complaint', 'delivery', 'open', 'click'
                ],
                Name: process.env.SES_CONFSET,
                Enabled: true,
                SNSDestination: {
                  TopicARN: topicArn
                }
              }
            }, (err, data) => {

              if (err) {
                return fn(err.message);
              }

              resolve();
            });
          });

        });
      });
    })
    .then(() => {
      // Add domains
      let encryptedKey = {
        key: encrypt(key.id),
        secret: encrypt(key.secret),
        region: key.region
      }

      return Promise.all(domains.map(domain => {
        return new Promise(resolve => {
          dbo.db().collection('domains').updateOne({
            domain: domain
          }, {
            $addToSet: {accs: accId},
            $set: {
              key: encryptedKey,
              type: 'ses',
              owner: accId
            }
          }, {upsert: true}, err => {
            if (!err)
              addedDomains.push(domain);

            return resolve();
          });
        });
      }));
    })
    .then(() => {
      return fn(null, addedDomains);
    }).catch(() => {
      return fn(null, addedDomains);
    });
  });
}

exports.updateFailureEmail = (domain, email, fn) => {

  if (!domain)
    return fn('No domain provided');
  email = email.toLowerCase().trim();
  if (!/^\S+@\S+$/.test(email))
    return fn('Email invalid. Confirm and try again');

  dbo.db().collection('domains').updateOne({
    domain: domain
  }, {$set: {
      failure_email: email
    }
  }, (err, status) => {
    if (err) {
      return fn('Internal Error');
    }

    fn(null, email);
  });
}

exports.clearFailureEmail = (domain, fn) => {

  if (!domain)
    return fn('No domain provided');

  dbo.db().collection('domains').updateOne({
    domain: domain
  }, {$unset: {
      failure_email: 1
    }
  }, (err, status) => {
    if (err) {
      return fn('Internal Error');
    }

    fn(null);
  });
}

// Connect Slack to the domain
exports.saveSlackAcc = (domain, params, fn) => {

  if (!domain)
    return fn('No domain provided');
  if (!params)
    return fn('Slack details empty');
  if (!params.team || !params.webhook)
    return fn('Slack details empty');

  dbo.db().collection('domains').updateOne({
    domain: domain
  }, {$set: {
      slack: {
        team: params.team,
        webhook: params.webhook
      }
    }
  }, (err, status) => {
    if (err) {
      return fn('Internal Error');
    }

    fn(null, params.team);
  });
}

// Disconnect Slack from the domain
exports.removeSlack = (domain, fn) => {

  if (!domain)
    return fn('No domain provided');

  dbo.db().collection('domains').updateOne({
    domain: domain
  }, {$unset: {slack: true}}, err => {
    if (err) {
      return fn('Internal Error');
    }

    fn();
  });
}

// Remove a user account from profile
exports.removeProfile = (id, accId, fn) => {

  if (!id) {
    if (fn)
      return fn('No domain id provided');

    return;
  }

  dbo.db().collection('domains').updateOne({
    _id: dbo.id(id)
  }, {$pull: {accs: dbo.id(accId)}}, err => {
    if (!fn)
      return;

    if (err) {
      return fn('Internal Error');
    }

    fn();
  });
}

// Delete the domain
exports.delete = (domain, fn) => {

  if (!domain)
    return fn('No domain provided');

  // Get domain
  dbo.db().collection('domains').findOne({
    domain: domain
  }, (err, doc) => {
    if (err)
      return fn('Internal Error');

    if (!doc)
      return fn('Domain not found');

    // Delete all
    dbo.db().collection('logs').remove({domain: domain});
    dbo.db().collection('mails').remove({domain: domain});
    dbo.db().collection('users').remove({domain: domain});
    dbo.db().collection('domains').remove({domain: domain}, err => {
      if (err)
        return fn('Internal Error');

      if (domain.type == 'ses') {
        return fn();
      }

      // Remove webhooks from Mailgun
      request.get({
        'url': `https://api.mailgun.net/v3/domains/${domain}/webhooks`,
        'gzip': true,
        'auth': {
          'user': 'api',
          'pass': decrypt(doc.key),
          'sendImmediately': false
        }
      }, (err, response, body) => {
        if (err && response.statusCode != 200)
          return fn();

        // Get all enabled webhook
        let enabled = [];
        body = JSON.parse(body);
        if (body.webhooks) {
          if (Object.keys(body.webhooks).length > 1) {
            for (let hook in body.webhooks) {
              if (body.webhooks[hook].url == process.env.WEBHOOK)
                enabled.push(hook);
            }
          }
        }

        // remove enabled webhooks
        // /domains/<domain>/webhooks/<webhookname>
        Promise.all(enabled.map(hook => {
            return new Promise(resolve => {
              request.delete({
                'url': `https://api.mailgun.net/v3/domains/${domain}/webhooks/${hook}`,
                'gzip': true,
                'auth': {
                  'user': 'api',
                  'pass': decrypt(doc.key),
                  'sendImmediately': false
                }
              }, (err, response, body) => {
                // Delete search index
                esc.deleteByQuery({
                  index: 'suet',
                  type: 'mails',
                  body: {
                    query: {
                      term: {domain: domain}
                    }
                  }
                }, (err, status) => {
                  return resolve();
                });
              });
            });
          })
        ).then(() => {
          return fn(null);
        });

      });

    });
  });
}
