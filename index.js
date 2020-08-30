const http = require("http");
const server = http.createServer();
const port = 3000;
const fs = require("fs");
const url = require("url");
const https = require("https");
const querystring = require("querystring");
const credentials = require('./auth/credentials.json');

server.on("listening", listening_handler);
server.listen(port);
function listening_handler(){
	console.log(`Now listen on port ${port}`);
}

server.on("request", connection_handler);

//if the user's input is vaid, the server first makes a post request to PetFinder API to request an access_token 
function connection_handler(req, res){
	console.log(`New request for ${req.url} from ${req.socket.remoteAddress}`);
	if (req.url === "/"){
		const html_main = fs.createReadStream("html/main.html");
		res.writeHead(200, {"Content-Type":"text/html"});
		html_main.pipe(res);
	}
	else if (req.url === "/banner/banner.jpg"){
		const banner = fs.createReadStream("banner/banner.jpg");
		res.writeHead(200, {'Content-Type':'image/jpeg'});
		banner.pipe(res);
	}
	else if (req.url.startsWith("/search")){
		const input = url.parse(req.url, true).query; //take an url object return a js object
		console.log("Performing PetFinder API request");
		//POST method 
		const auth_cache = "./cache/auth-res.json";
		cache_access_token(auth_cache, input, res);
	}
	else {
		res.writeHead(404, {"Content-Type":"text/plain"});
		res.write("404 Not Found");
		res.end();
	}
}

//check if the access token is expired or not 
//if it is expired, request a new one
//if it is not expired, move to send_access_token_req
function cache_access_token(auth_cache, input, res){
	let cache_valid = false;
	let cache_auth_file = "";
	if (fs.existsSync(auth_cache)){
		cache_auth_file = require(auth_cache);
		if (new Date(cache_auth_file.expiration) > Date.now()){
			cache_valid = true;
		}
		else {
			console.log("Token Expired");
		}
	}
	if (cache_valid){
		console.log("Token is not expired yet");
		start_search_req(cache_auth_file, input, res);
	}
	else{
		send_access_token_req(auth_cache, input, res);
	}
}

//Send a POST request to the PetFinder API to ask for an access token 
function send_access_token_req(auth_cache, input, res){
	let base64data = Buffer.from(`${credentials.client_id}:${credentials.client_secret}`).toString('base64');
	let authorization = `Basic ${base64data}`;
	
	let post_data = querystring.stringify({//convert js obj to query string format: grant_type=client_credentials&foo=abcn
		'grant_type':'client_credentials'
	});
	let options = {
		method:'POST',
		headers:{
			'Content-Type':'application/x-www-form-urlencoded',
			'Authorization':authorization,
			'Content-Length':Buffer.byteLength(post_data)//find length of post_data
		}
	};
	const token_endpoint = 'https://api.petfinder.com/v2/oauth2/token';
	let auth_sent_time = new Date(); //create a new Date object which represents the current date and time as of the time of instantiation.
	let auth_req = https.request(token_endpoint, options, function (auth_res){
		received_auth(auth_cache, auth_res, input, auth_sent_time, res);
	});
	
	auth_req.on('error', function(e){
		console.error(e);
	});
	console.log("Requesting Token");
	auth_req.end(post_data);//because this is a POST request, querystring is placed into the body of the request
}

//catch the access token 
function received_auth(auth_cache, auth_res, input, auth_sent_time, res){
	auth_res.setEncoding("utf8");
	let body = "";
	auth_res.on("data", function(chunk){
		body += chunk;
	});
	auth_res.on("end", function(){
		let petFinder_auth = JSON.parse(body);//convert from JSON to js obj
		petFinder_auth.expiration = (new Date(new Date(auth_sent_time).getTime() + (60*60*1000)).toJSON());//calculate the time the token expires (1hr from auth_sent_time)
		create_access_token_cache(auth_cache, petFinder_auth);
		start_search_req(petFinder_auth, input, res);
	});
}

//create a JSON file that contains the access_token and its expiration time
function create_access_token_cache(auth_cache, petFinder_auth){
	let petFinder_auth_json = JSON.stringify(petFinder_auth);//convert js obj to JSON string
	fs.writeFile(auth_cache, petFinder_auth_json, function(err){//write petFinder_auth_json to authentication_cache
		if (err)throw err;
	});
}

//Send a GET request to the PetFinder API to request for the type of animal related to the users search query
function start_search_req(petFinder_auth, input, res){
	let query = querystring.stringify({//convert from js obj to query string
		type:`${input.animals}`
	});
	let access_token = `Bearer ${petFinder_auth.access_token}`;
	
	const animals_endpoint = `https://api.petfinder.com/v2/animals?${query}`;
	let animals_req = https.request(animals_endpoint, {method:"GET", headers:{'Authorization':`${access_token}`}}, function (animals_res){
		received_animals(animals_res, input, res);
	});
	
	animals_req.on('error', function(er){
		console.error(er);
	});
	console.log("Requesting Animals");
	animals_req.end();
}

//Catch the information of each animal 
function received_animals(animals_res, input, res){
	animals_res.setEncoding("utf8");
	let body = "";
	animals_res.on("data", function(chunk){
		body += chunk;
	});
	animals_res.on("end", function(){
		let animals_info = JSON.parse(body);//convert from a JSON string to js obj
		let animals_array_length = animals_info.animals.length;
		if (animals_array_length > 10){
			animals_array_length = 10;
		}
		let animals_array = [];
		for (let i = 0; i < animals_array_length; i++){
			animals_array[i] = {
				id: `${animals_info.animals[i].id}`,
				breed:`${animals_info.animals[i].breeds.primary}`,
				gender:`${animals_info.animals[i].gender}`,
				name:`${animals_info.animals[i].name}`,
				status:`${animals_info.animals[i].status}`
			}
		}
		get_cat_fact(animals_array, input, res);
	});
}

//Send the GET request to the CatFact API to request for a random cat fact
function get_cat_fact(animals_array, input, res){
	let max_length = Math.floor(Math.random() * 200) + 20; // returns a random integer from 20 to 219
	const cat_fact_endpoint = `https://catfact.ninja/fact?max_length=${max_length}`;
	const cat_fact_req = https.request(cat_fact_endpoint, {method:"GET", headers:{"Accept":"application/json"}}, function (cat_fact_res){
		received_fact(cat_fact_res, animals_array, input, res);
	});
	
	cat_fact_req.on('error', function(e){
		console.error(e);
	});
		 
	console.log("Requesting a Cat Fact");
	cat_fact_req.end();
}

//Catch the random cat fact from the data received from the Cat Fact API
function received_fact(cat_fact_res, animals_array, input, res){
	let fact_data = "";
	cat_fact_res.on("data", function(chunk){
		fact_data += chunk;
	});
	cat_fact_res.on("end", function(){
		let fact_obj = JSON.parse(fact_data);//convert a JSON string to a js obj
		let fact = fact_obj.fact;
		webpage(fact, animals_array, input, res);
	});
}

//Collect all data from the two APIs and display them onto a webpage
//Then send the webpage to the client 
function webpage(fact, animals_array, input, res){
	let count = 0;
	let display_animals = [];
	for (let i = 0; i < animals_array.length; i++){
		count++;
		display_animals[i] = `<div>
		<h3>${count}: ${animals_array[i].name}</h3>
		<div>Id: ${animals_array[i].id}</div>
		<div>Breed: ${animals_array[i].breed}</div>
		<div>Gender: ${animals_array[i].gender}</div>
		<div>Status: ${animals_array[i].status}</div>
		</div>`;
	}
	res.writeHead(200, {'Content-Type':'text/html'});
	res.end(`<h1>A Random Cat Fact:</h1><div>${fact}</div>
			 <h1>Search Results for ${input.animals}</h1>${display_animals.join("")}`
	);// send all the information to the client 
}