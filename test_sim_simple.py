import json, urllib.request

req_data = json.dumps({
    "command": "xezim --simulate $FILE",
    "code": """
module top_tb;
    logic clk;
    logic rst_n;

    initial begin
        clk = 0;
        forever #5 clk = ~clk;
    end

    initial begin
        rst_n = 0;
        #15 rst_n = 1;
        #50;
        $display("MINIMAL RUN SUCCESS");
        $finish;
    end
endmodule
"""
}).encode("utf-8")

req = urllib.request.Request("https://wtb-sim.onrender.com/lint", data=req_data, headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        print("EXIT CODE:", res.get("exit_code"))
        print("STDOUT:\n", res.get("stdout"))
        print("STDERR:\n", res.get("stderr"))
except Exception as e:
    print("ERROR:", e)
