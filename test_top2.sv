module top;
    logic clk;
    logic [7:0] count;
    initial begin
        clk = 0;
        count = 0;
        ("wave.vcd");
        ;
        #10 clk = 1; count = 5;
        #10 ;
    end
endmodule