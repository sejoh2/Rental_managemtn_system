const dotenv = require("dotenv");

dotenv.config();

const app = require("./app");

const {
    init_auth_tables,
} = require("./src/auth/auth_tables");


const {
    init_property_tables,
} = require("./src/properties/property_tables");


// const {
//     init_payment_tables,
// } = require("./src/payments/payment_tables");

const PORT = process.env.PORT || 8080;

async function start_server() {
    try {
        /*
        |--------------------------------------------------------------------------
        | Initialise Database
        |--------------------------------------------------------------------------
        */

        await init_auth_tables();

        console.log(
            "Authentication tables initialized successfully."
        );


        await init_property_tables();

        console.log(
            "Property tables initialized successfully."
        );


        // await init_payment_tables();

        // console.log(
        //     "Payment tables initialized successfully."
        // );

        /*
        |--------------------------------------------------------------------------
        | Start HTTP Server
        |--------------------------------------------------------------------------
        */

        app.listen(PORT, () => {
            console.log("");
            console.log("========================================");
            console.log("Rental Management Backend Started");
            console.log("========================================");
            console.log(`Server : http://localhost:${PORT}`);
            console.log("Module : Authentication + Properties + Payments");
            console.log("Status : Running");
            console.log("========================================");
            console.log("");
        });
    } catch (error) {
        console.error("");
        console.error("========================================");
        console.error("Failed to start server");
        console.error("========================================");
        console.error(error);
        console.error("========================================");
        console.error("");

        process.exit(1);
    }
}

start_server();