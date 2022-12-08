//todo: gebrauch von "" und '' vereinheitlichen

const express = require("express");
const session = require("express-session");
const dotenv = require("dotenv");
const helpers = require("./helpers");
const bodyParser = require("body-parser");
const pg = require("pg");
const bcrypt = require('bcrypt');

/* Reading global variables from config file */
dotenv.config();
const PORT = process.env.PORT;
const conString = process.env.DB_CON_STRING;
const saltRounds = 10;

const dbConfig = {
  connectionString: conString,
  ssl: {
    rejectUnauthorized: false
  }
}

pg.defaults.ssl = true;
var dbClient = new pg.Client(dbConfig);
dbClient.connect();

app = express();

var urlencodedParser = bodyParser.urlencoded({
  extended: false
});

app.use(session({
  secret: "This is a secret!",
  cookie: {
    maxAge: 3600000
  },
  resave: false,
  saveUninitialized: false
}));


//turn on serving static files (required for delivering css to client)
app.use(express.static("public"));
//configure template engine
app.set("views", "views");
app.set("view engine", "pug");



app.get('/', async (req, res) => {

  if (req.session.user != undefined) {

    var user = req.session.user;
    var dbrows;
    var shares = [];
    var userid;

    dbClient.query("SELECT * FROM users WHERE name=$1", [user], function(dbError, dbResponse) {
      userid = dbResponse.rows[0].id;
      //console.log(userid);


      dbClient.query("SELECT symbol, sum(count) FROM finance_transactions WHERE account_id = $1 GROUP BY symbol HAVING SUM(count) > 0 ORDER BY SUM(count) DESC", [userid], async (dbError, dbResponse) => {
        console.log(dbResponse);
        dbrows = dbResponse.rows;


        for (var i = 0; dbrows[i] != undefined; i++) {

          var result = await helpers.lookup(dbrows[i].symbol);
          var price = parseFloat(result.latestPrice).toFixed(2);
          var sum = parseFloat(dbrows[i].sum);
          var total = price * sum;

          var share = [
            dbrows[i].symbol,
            result.companyName,
            sum,
            price,
            total
          ]
          shares.push(share);

        }

        res.render("index", {
          user: user,
          shares: shares
        });

      });

    });

  } else {
    res.render("login");
  }
});


app.get('/register', function(req, res) {
  res.render("register");
});

app.post('/register', urlencodedParser, function(req, res) {
  var username = req.body.username;
  var password = req.body.password;
  var password_confirmation = req.body.confirmation;


  if (username == '') {
    res.status(400).render("register", {
      error: "Nutzername darf nicht leer sein"
    });
  }
  // passwortabgleich noch aus der datenbankabfrage rausziehen sonst evtl. unnötige datenbankabfrage
  dbClient.query("SELECT * FROM users WHERE name=$1", [username], function(dbError, dbResponse) {
    if (password == password_confirmation) {
      if (dbResponse.rows.length == 0) {
        bcrypt.hash(password, saltRounds, function(err, hash) {
          dbClient.query("INSERT INTO users (name, password) VALUES ($1, $2)", [username, hash], function(dbError, dbResponse) {
            req.session.user = username;
            res.render("index", {
              user: req.session.user
            });
          });
        });
      } else {
        res.status(400).render("register", {
          error: "Nutzername bereits vergeben"
        })
      };
    } else {
      res.status(400).render("register", {
        error: "Passwörter stimmen nicht überein"
      });
    }
  });
});



app.get("/login", urlencodedParser, function(request, response) {
  response.render("login");
});

app.post('/login', urlencodedParser, function(req, res) {
  var username = req.body.username;
  var password = req.body.password;

  try {
    dbClient.query("SELECT * FROM users WHERE name=$1", [username], function(dbError, dbResponse) {

      var dbName = dbResponse.rows[0].name;
      var dbPassword = dbResponse.rows[0].password;


      bcrypt.compare(password, dbPassword, function(err, result) {
        if (result == true) {
          req.session.user = username;
          res.redirect("/");
        } else {
          res.status(400).render("login", {
            error: "Falsches Passwort"
          });
        }
      });
    });
  } catch (err) {
    res.status(400).render("login", {
      error: "Nutzername existiert nicht"
    });
  }
});

app.get('/buy', function(req, res) {
  if (req.session.user != undefined) {
    res.render("buy", {
      user: req.session.user
    });
  } else {
    res.render("pre_login_error", {
      error: "Sie müssen eingeloggt sein um auf diese Seite zugreifen zu können"
    });
  }
});

app.post("/buy", urlencodedParser, async (req, res) => {

  if (req.session.user != undefined) {

    var symbol = req.body.symbol;
    var shares = req.body.shares;

    if (symbol != "") {
      if (shares % 1 === 0 && shares > 0) {
        try {

          var result = await helpers.lookup(symbol);
          var price = result.latestPrice * shares;

          dbClient.query("SELECT balance, id FROM users WHERE name=$1", [req.session.user], function(dbError, dbResponse) {

            var balance = dbResponse.rows[0].balance;
            var account_id = dbResponse.rows[0].id;

            if (balance >= price) {
              balance = balance - price;
              dbClient.query("UPDATE users SET balance=$1 WHERE name=$2", [balance, req.session.user]);
              dbClient.query("INSERT INTO finance_transactions (account_id, symbol, name, count, price) VALUES ($1, $2, $3, $4, $5)", [account_id, symbol, result.companyName, shares, result.latestPrice]);
              res.render("buy", {
                balance: balance.toFixed(2),
                user: req.session.user
              });
            } else {
              res.status(400).render("buy", {
                error: "Nicht genug Guthaben"
              });
            }

          });

        } catch (err) {
          res.status(400).render("buy", {
            error: "Ungültiges Tickersymbol oder fehlerhafte Verbindung"
          });
        }
      } else {
        res.status(400).render("buy", {
          error: "Es wurde keine gültige Ganzzahl eingegeben"
        });
      }
    } else {
      res.status(400).render("buy", {
        error: "Ungültiges Tickersymbol"
      });
    }
  } else {
    res.render("pre_login_error", {
      error: "Sie müssen eingeloggt sein um auf diese Seite zugreifen zu können"
    });
  }
});

app.get('/quote', function(req, res) {
  if (req.session.user != undefined) {
    res.render("quote", {
      user: req.session.user
    });
  } else {
    res.render("pre_login_error", {
      error: "Sie müssen eingeloggt sein um auf diese Seite zugreifen zu können"
    });
  }
});

app.post('/quote', urlencodedParser, async (req, res) => {

  if (req.session.user != undefined) {

    var symbol = req.body.symbol;

    if (symbol != "") {
      try {
        var result = await helpers.lookup(symbol);
        res.render("quote", {
          result: result,
          user: req.session.user
        });
      } catch {
        res.status(400).render("quote", {
          error: "Ungültiges Tickersymbol oder fehlerhafte Verbindung"
        });
      }
    } else {
      res.status(400).render("quote", {
        error: "Ungültiges Tickersymbol"
      });
    }
  } else {
    res.render("pre_login_error", {
      error: "Sie müssen eingeloggt sein um auf diese Seite zugreifen zu können"
    });
  }
});

app.get("/history", function(req, res) {
  if (req.session.user != undefined) {
    var user = req.session.user;

    dbClient.query("SELECT * FROM finance_transactions WHERE account_id = (SELECT id FROM users WHERE name=$1)", [user], function(dbError, dbResponse) {
      var rows = dbResponse.rows;
      console.log(rows)
      res.render("history", {
        rows: rows,
        user: user
      });
    });

  } else {
    res.render("pre_login_error", {
      error: "Sie müssen eingeloggt sein um auf diese Seite zugreifen zu können"
    });
  }
});

app.get("/sell", function(req, res) {
  if (req.session.user != undefined) {
    res.render("sell", {
      user: req.session.user
    });
  } else {
    res.render("pre_login_error", {
      error: "Sie müssen eingeloggt sein um auf diese Seite zugreifen zu können"
    });
  }
});

app.post("/sell", urlencodedParser, async (req, res) => {

  if (req.session.user != undefined) {

    var symbol = req.body.symbol;
    var shares = req.body.shares;

    if (symbol != "") {
      if (shares % 1 === 0 && shares > 0) {
        try {

          var result = await helpers.lookup(symbol);
          var price = result.latestPrice * shares;

          dbClient.query("SELECT id, balance FROM users WHERE name=$1", [req.session.user], async (dbError, dbResponse) => {

            var balance = dbResponse.rows[0].balance;
            var account_id = dbResponse.rows[0].id;

            dbClient.query("SELECT symbol, sum(count) FROM finance_transactions WHERE account_id = $1 AND symbol = $2 GROUP BY symbol HAVING SUM(count) > 0", [account_id, symbol], function(dbError, dbResponse) {

              var dbrows = dbResponse.rows[0];
              console.log(dbrows)

              if (dbrows.sum >= shares) {
                balance = parseInt(balance);
                shares *= -1;
                balance += price;
                dbClient.query("UPDATE users SET balance=$1 WHERE id=$2", [balance, account_id]);
                dbClient.query("INSERT INTO finance_transactions (account_id, symbol, name, count, price) VALUES ($1, $2, $3, $4, $5)", [account_id, symbol, result.companyName, shares, result.latestPrice]);
                res.render("sell", {
                  balance: balance,
                  user: req.session.user
                });
              } else {
                res.status(400).render("sell", {
                  error: "Die Anzahl der Aktien ist nicht ausreichend"
                });
              }
            });

          });

        } catch (err) {
          console.log(err);
          res.status(400).render("sell", {
            error: "Ungültiges Tickersymbol oder fehlerhafte Verbindung"
          });
        }
      } else {
        res.status(400).render("sell", {
          error: "Es wurde keine gültige Ganzzahl eingegeben"
        });
      }
    } else {
      res.status(400).render("sell", {
        error: "Ungültiges Tickersymbol"
      });
    }
  } else {
    res.render("pre_login_error", {
      error: "Sie müssen eingeloggt sein um auf diese Seite zugreifen zu können"
    });
  }
});

app.get("/accoptions", function(req, res) {
  if (req.session.user != undefined) {
    res.render("accoptions", {
      user: req.session.user
    });
  } else {
    res.render("pre_login_error", {
      error: "Sie müssen eingeloggt sein um auf diese Seite zugreifen zu können"
    });
  }
});

app.post("/newpw", urlencodedParser, function(req, res) {

  console.log(req.body);
  var username = req.session.user;

  var password = req.body.password;
  var password_confirmation = req.body.confirmation;

  if (password == password_confirmation) {
    bcrypt.hash(password, saltRounds, function(err, hash) {
      dbClient.query("UPDATE users SET password=$1 WHERE name=$2", [hash, username], function(dbError, dbResponse) {
        res.render("accoptions", {
          user: req.session.user,
          success: "Passwort wurde erfolgreich geändert"
        });
      });
    });
  } else {
    res.status(400).render("accoptions", {
      error: "Passwörter stimmen nicht überein"
    });
  }
});

app.post("/delete", urlencodedParser, function(req, res) {
  dbClient.query("DELETE FROM users WHERE name=$1", [req.session.user], function(dbError, dbResponse) {
    res.render("register", {
      success: "Sie haben uns erfolgreich Ihr restliches Vermögen übertragen"
    })
  })
});

app.get("/help", function(req, res) {
  res.render("help", {
    user: req.session.user
  });
})

app.get("/logout", function(req, res) {
  req.session.destroy(function(err) {
    console.log("Session destroyed.");
  });
  res.render("login");
});

app.get("/impressum", function(req, res) {
  res.render("impressum", {
    user: req.session.user
  });
})

app.listen(PORT, function() {
  console.log(`MI Finance running and listening on port ${PORT}`);
});
